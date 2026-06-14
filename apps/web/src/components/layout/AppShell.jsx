import React from "react";
import { StatusBanner } from "../common/index.js";
import AppNotifications from "./AppNotifications.jsx";
import Header from "./Header.jsx";
import Sidebar from "./Sidebar.jsx";

function AppShell({ notifications, sidebar, header, syncState, children }) {
  return (
    <main className="shell">
      <AppNotifications {...notifications} />
      <Sidebar {...sidebar} />
      <section className="workspace">
        <Header {...header} />
        <StatusBanner status={syncState.status} error={syncState.error} lastSyncAt={syncState.lastSyncAt} />
        {children}
      </section>
    </main>
  );
}

export default AppShell;
