//! Reading the Windows registry directly (read-only), in the same text `reg query` prints, so the
//! readers of that text stay as they are. Starting `reg.exe` took seconds on some computers each
//! time Arcade looked at its launchers (D-152); asking Windows itself takes milliseconds.

use windows_sys::Win32::Foundation::ERROR_SUCCESS;
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegEnumKeyExW, RegEnumValueW, RegOpenKeyExW, RegQueryInfoKeyW, HKEY, HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, HKEY_USERS, KEY_READ,
    REG_DWORD, REG_EXPAND_SZ, REG_MULTI_SZ, REG_QWORD, REG_SZ,
};

/// A key as `reg query` prints it: `key` is like `HKLM\SOFTWARE\…`; with `recursive`, its subkeys
/// too (`/s`). Nothing when the key isn't there.
pub fn query(key: &str, recursive: bool) -> String {
    let mut out = String::new();
    let Some((root, root_name, path)) = split(key) else { return out };
    let Some(handle) = open(root, path) else { return out };
    let full = if path.is_empty() { root_name.to_string() } else { format!("{root_name}\\{path}") };
    write_key(handle, &full, recursive, 0, &mut out);
    unsafe { RegCloseKey(handle) };
    out
}

/// One value of a key, as text, or none.
pub fn value(key: &str, name: &str) -> Option<String> {
    let text = query(key, false);
    text.lines().find_map(|line| {
        let mut parts = line.trim().splitn(3, "    ");
        let found = parts.next()?.trim();
        let _kind = parts.next()?;
        found.eq_ignore_ascii_case(name).then(|| parts.next().map(|v| v.trim().to_string())).flatten()
    })
}

fn split(key: &str) -> Option<(HKEY, &'static str, &str)> {
    let (root, path) = key.split_once('\\').unwrap_or((key, ""));
    let (handle, name) = match root.to_ascii_uppercase().as_str() {
        "HKLM" | "HKEY_LOCAL_MACHINE" => (HKEY_LOCAL_MACHINE, "HKEY_LOCAL_MACHINE"),
        "HKCU" | "HKEY_CURRENT_USER" => (HKEY_CURRENT_USER, "HKEY_CURRENT_USER"),
        "HKCR" | "HKEY_CLASSES_ROOT" => (HKEY_CLASSES_ROOT, "HKEY_CLASSES_ROOT"),
        "HKU" | "HKEY_USERS" => (HKEY_USERS, "HKEY_USERS"),
        _ => return None,
    };
    Some((handle, name, path.trim_end_matches('\\')))
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn open(parent: HKEY, path: &str) -> Option<HKEY> {
    let mut key: HKEY = std::ptr::null_mut();
    let status = unsafe { RegOpenKeyExW(parent, wide(path).as_ptr(), 0, KEY_READ, &mut key) };
    (status == ERROR_SUCCESS).then_some(key)
}

fn write_key(key: HKEY, name: &str, recursive: bool, depth: usize, out: &mut String) {
    let (mut subkeys, mut values, mut longest_sub, mut longest_name, mut longest_data) = (0u32, 0u32, 0u32, 0u32, 0u32);
    let status = unsafe {
        RegQueryInfoKeyW(
            key,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null(),
            &mut subkeys,
            &mut longest_sub,
            std::ptr::null_mut(),
            &mut values,
            &mut longest_name,
            &mut longest_data,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if status != ERROR_SUCCESS {
        return;
    }
    out.push('\n');
    out.push_str(name);
    out.push('\n');
    let mut name_buf = vec![0u16; longest_name as usize + 2];
    let mut data = vec![0u8; longest_data as usize + 4];
    for index in 0..values {
        let mut name_len = name_buf.len() as u32;
        let mut data_len = data.len() as u32;
        let mut kind = 0u32;
        let status = unsafe { RegEnumValueW(key, index, name_buf.as_mut_ptr(), &mut name_len, std::ptr::null(), &mut kind, data.as_mut_ptr(), &mut data_len) };
        if status != ERROR_SUCCESS {
            continue;
        }
        let value_name = String::from_utf16_lossy(&name_buf[..name_len as usize]);
        let value_name = if value_name.is_empty() { "(Default)".to_string() } else { value_name };
        let bytes = &data[..data_len as usize];
        let (kind_name, text) = match kind {
            REG_SZ => ("REG_SZ", utf16(bytes)),
            REG_EXPAND_SZ => ("REG_EXPAND_SZ", utf16(bytes)),
            REG_MULTI_SZ => ("REG_MULTI_SZ", utf16(bytes).replace('\0', "\\0")),
            REG_DWORD if bytes.len() >= 4 => ("REG_DWORD", format!("0x{:x}", u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))),
            REG_QWORD if bytes.len() >= 8 => ("REG_QWORD", format!("0x{:x}", u64::from_le_bytes(bytes[..8].try_into().unwrap_or([0; 8])))),
            _ => continue,
        };
        // One line per value, as `reg query` prints it.
        out.push_str(&format!("    {value_name}    {kind_name}    {}\n", text.replace(['\r', '\n'], " ")));
    }
    if !recursive || depth > 16 {
        return;
    }
    let mut sub_buf = vec![0u16; longest_sub as usize + 2];
    for index in 0..subkeys {
        let mut len = sub_buf.len() as u32;
        let status = unsafe { RegEnumKeyExW(key, index, sub_buf.as_mut_ptr(), &mut len, std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut()) };
        if status != ERROR_SUCCESS {
            continue;
        }
        let sub_name = String::from_utf16_lossy(&sub_buf[..len as usize]);
        if let Some(sub) = open(key, &sub_name) {
            write_key(sub, &format!("{name}\\{sub_name}"), true, depth + 1, out);
            unsafe { RegCloseKey(sub) };
        }
    }
}

/// A registry string: UTF-16, without its ending NULs.
fn utf16(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    String::from_utf16_lossy(&units).trim_end_matches('\0').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_like_reg_query() {
        // A key every Windows has, read both ways.
        let key = "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
        let ours = super::super::launchers::reg_blocks(&query(key, false));
        assert_eq!(ours.len(), 1);
        assert!(ours[0].key.starts_with("HKEY_LOCAL_MACHINE\\SOFTWARE"));
        assert!(ours[0].get("ProductName").is_some());
        assert!(value(key, "CurrentBuild").is_some_and(|b| b.chars().all(|c| c.is_ascii_digit())));
        assert!(query("HKLM\\SOFTWARE\\Digitify-not-here", true).is_empty());
    }
}
