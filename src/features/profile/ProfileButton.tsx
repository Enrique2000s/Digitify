import { Link, useRouterState } from "@tanstack/react-router";
import { useProfile } from "./data";
import { ProfileAvatar } from "./Picture";

/** Your picture in the title bar (D-149): it opens your profile. */
export function ProfileButton() {
  const profile = useProfile();
  const here = useRouterState({ select: (state) => state.location.pathname === "/profile" });
  const name = profile.data?.name || "My Digitify";
  return (
    <Link to="/profile" className="round-btn profile-button" aria-label={`Your profile: ${name}`} title="Your profile" aria-current={here ? "page" : undefined}>
      <ProfileAvatar profile={profile.data} size={32} />
    </Link>
  );
}
