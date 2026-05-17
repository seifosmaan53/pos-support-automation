import { Routes, Route } from "react-router-dom";
import { HomePage } from "../pages/HomePage";
import { SetupWizardPage } from "../pages/SetupWizardPage";
import { SmokeTestPage } from "../pages/SmokeTestPage";
import { PilotPage } from "../pages/PilotPage";
import { VoiceTicketPage } from "../pages/VoiceTicketPage";
import { TranscriptReviewPage } from "../pages/TranscriptReviewPage";
import { ExtractedDetailsPage } from "../pages/ExtractedDetailsPage";
import { TicketFormHelperPage } from "../pages/TicketFormHelperPage";
import { GeneratedTicketPage } from "../pages/GeneratedTicketPage";
import { HistoryPage } from "../pages/HistoryPage";
import { KnowledgeBasePage } from "../pages/KnowledgeBasePage";
import { TemplatesPage } from "../pages/TemplatesPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SystemCheckPage } from "../pages/SystemCheckPage";
import { HelpPage } from "../pages/HelpPage";
import { RemindersPage } from "../pages/RemindersPage";
import { StyleExamplesPage } from "../pages/StyleExamplesPage";
import { TicketIntelligencePage } from "../pages/TicketIntelligencePage";
import { WritingLabPage } from "../pages/WritingLabPage";
import { KeyboardShortcutsHandler } from "../components/KeyboardShortcutsHandler";
import { FirstRunRedirect } from "../components/FirstRunRedirect";

export function AppRoutes() {
  return (
    <>
      <KeyboardShortcutsHandler />
      <FirstRunRedirect />
      <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/setup" element={<SetupWizardPage />} />
      <Route path="/smoke-test" element={<SmokeTestPage />} />
      <Route path="/pilot" element={<PilotPage />} />
      <Route path="/voice" element={<VoiceTicketPage />} />
      <Route path="/transcript" element={<TranscriptReviewPage />} />
      <Route path="/details" element={<ExtractedDetailsPage />} />
      <Route path="/form" element={<TicketFormHelperPage />} />
      <Route path="/ticket" element={<GeneratedTicketPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/intelligence" element={<TicketIntelligencePage />} />
      <Route path="/reminders" element={<RemindersPage />} />
      <Route path="/style-examples" element={<StyleExamplesPage />} />
      <Route path="/knowledge" element={<KnowledgeBasePage />} />
      <Route path="/templates" element={<TemplatesPage />} />
      <Route path="/writing-lab" element={<WritingLabPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/system" element={<SystemCheckPage />} />
      <Route path="/help" element={<HelpPage />} />
      </Routes>
    </>
  );
}
