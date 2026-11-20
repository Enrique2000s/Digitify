//! SteamGridDB (D-128): its community's box art, for any game by its name (and Steam's by their
//! app id), when the user has given Digitify their own SteamGridDB API key (free, from their
//! account's preferences). The key stays in Digitify's configuration on this computer and is sent
//! only to SteamGridDB, with each search. Without a key nothing is asked of it.

const API: &str = "https://www.steamgriddb.com/api/v2";

/// Box art sizes asked for: the vertical capsules a library shows.
const DIMENSIONS: &str = "600x900,342x482,660x930";

fn get(key: &str, path: &str) -> Option<serde_json::Value> {
    let request = crate::online::http::get(&format!("{API}{path}")).ok()?.set("Authorization", &format!("Bearer {key}"));
    crate::online::http::json("SteamGridDB", request).ok().filter(|json| json.get("success").and_then(|s| s.as_bool()) == Some(true))
}

/// Whether a key works: a search answers with it.
pub fn key_works(key: &str) -> bool {
    get(key, "/search/autocomplete/mario").is_some()
}

/// A title for searching: without "(USA)", "[!]" and the like.
pub fn search_name(title: &str) -> String {
    let mut out = String::new();
    let mut depth = 0;
    for c in title.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The games SteamGridDB knows by a name: (id, name), best first.
pub fn search(key: &str, title: &str) -> Vec<(i64, String)> {
    let name = search_name(title);
    if name.len() < 2 {
        return Vec::new();
    }
    let path = format!("/search/autocomplete/{}", url::form_urlencoded::byte_serialize(name.as_bytes()).collect::<String>().replace('+', "%20"));
    get(key, &path)
        .and_then(|json| json.get("data")?.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|game| Some((game.get("id")?.as_i64()?, game.get("name")?.as_str()?.to_string())))
        .collect()
}

fn grids(key: &str, path: &str, limit: usize) -> Vec<String> {
    get(key, &format!("{path}?dimensions={DIMENSIONS}&types=static&nsfw=false&humor=false"))
        .and_then(|json| json.get("data")?.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|grid| grid.get("url")?.as_str().map(str::to_string))
        .take(limit)
        .collect()
}

/// A SteamGridDB game's box art.
pub fn game_grids(key: &str, id: i64, limit: usize) -> Vec<String> {
    grids(key, &format!("/grids/game/{id}"), limit)
}

/// A Steam game's box art, by its app id.
pub fn steam_grids(key: &str, app: &str, limit: usize) -> Vec<String> {
    if !app.chars().all(|c| c.is_ascii_digit()) {
        return Vec::new();
    }
    grids(key, &format!("/grids/steam/{app}"), limit)
}

/// The first box art found for a name (Find missing covers, a new game): the game whose name
/// matches best.
pub fn first_for(key: &str, title: &str) -> Option<String> {
    let wanted = simple(&search_name(title));
    let found = search(key, title);
    let game = found.iter().find(|(_, name)| simple(name) == wanted).or(found.first())?;
    game_grids(key, game.0, 1).into_iter().next()
}

fn simple(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase()
}

#[cfg(test)]
mod tests {
    #[test]
    fn titles_are_searched_without_their_tags() {
        assert_eq!(super::search_name("Super Mario 64 (USA) [!]"), "Super Mario 64");
        assert_eq!(super::search_name("Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De)"), "Legend of Zelda, The - Ocarina of Time");
    }
}
