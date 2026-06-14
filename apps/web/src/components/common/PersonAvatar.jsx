import React from "react";

function PersonAvatar({ name = "", photoUrl = "" }) {
  const initial = String(name || "?").trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span className={`avatar ${photoUrl ? "has-photo" : ""}`}>
      {photoUrl ? <img src={photoUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; event.currentTarget.parentElement?.classList.remove("has-photo"); }} /> : null}
      <em>{initial}</em>
    </span>
  );
}

export default PersonAvatar;
