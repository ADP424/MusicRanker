import { Link } from "react-router-dom";
import { useCan, useGuild } from "./GuildProvider";

const SECTIONS = [
  { to: "music", icon: "🎵", label: "Music", ready: true },
  { to: "movies", icon: "🎬", label: "Movies", ready: true },
  { to: "television", icon: "📺", label: "Television", ready: true },
  { to: "games", icon: "🎮", label: "Games", ready: true },
  { to: "people", icon: "👤", label: "People", ready: true },
];

export function GuildHomePage() {
  const guild = useGuild();
  const canMerge = useCan("merge_in");
  const canManage = useCan("manage_members");

  return (
    <div className="home-page">
      <h1 className="home-title">{guild.name}</h1>
      <div className="home-choices">
        {SECTIONS.map((s) => (
          <Link key={s.to} to={s.ready ? s.to : "#"} className="home-choice"
                style={s.ready ? undefined : { opacity: 0.35, pointerEvents: "none" }}>
            <span className="home-choice-icon">{s.icon}</span>
            <span className="home-choice-label">{s.label}</span>
            {!s.ready && <span className="meta">coming soon</span>}
          </Link>
        ))}
      </div>
      {(canManage || canMerge) && (
        <div className="home-actions">
          {canManage && <Link to="members" className="home-action-btn">Members</Link>}
          {canMerge && <Link to="merge" className="home-action-btn">Merge a guild in</Link>}
        </div>
      )}
    </div>
  );
}
