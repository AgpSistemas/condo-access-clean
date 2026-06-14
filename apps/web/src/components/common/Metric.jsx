import React from "react";

function Metric({ label, value, icon: Icon }) {
  return <article className="metric"><Icon size={22} /><strong>{value}</strong><span>{label}</span></article>;
}

export default Metric;
