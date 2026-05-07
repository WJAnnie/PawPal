import type { JSX } from "react";
import { i18n } from "../../shared/i18n";
import { ChatWindow } from "./components/ChatWindow";
import { FrisbeeWindow } from "./components/FrisbeeWindow";
import { PetView } from "./components/PetView";
import { SettingsView } from "./components/SettingsView";
import { pawpalApi } from "./pawpalApi";

function PreloadUnavailable(): JSX.Element {
  const labels = i18n("zh-CN").settings;
  return (
    <main className="settings-shell">
      <header>
        <p className="eyebrow">AI-WorkPet</p>
        <h1>{labels.preloadUnavailable}</h1>
      </header>
      <section className="settings-section">
        <p className="diagnostic-copy">{labels.preloadCopy}</p>
      </section>
    </main>
  );
}

export default function App(): JSX.Element {
  if (!pawpalApi()) return <PreloadUnavailable />;

  const route = window.location.hash.replace("#", "");
  if (route === "settings") return <SettingsView />;
  if (route === "chat") return <ChatWindow />;
  if (route === "frisbee") return <FrisbeeWindow />;
  return <PetView />;
}
