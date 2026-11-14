import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { I18nProvider } from './i18n/I18nProvider';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { RequirementsPage } from './pages/RequirementsPage';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { DiagramEditorPage } from './pages/DiagramEditorPage';

export function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/projects/:id/requirements" element={<RequirementsPage />} />
          <Route path="/projects/:id/architecture" element={<ArchitecturePage />} />
          <Route path="/projects/:id/diagrams/:diagramId" element={<DiagramEditorPage />} />
          <Route path="/diagrams/:diagramId" element={<DiagramEditorPage />} />
        </Routes>
      </AuthProvider>
    </I18nProvider>
  );
}
