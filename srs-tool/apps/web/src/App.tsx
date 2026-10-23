import { Routes, Route, Navigate } from 'react-router-dom';
import { ProjectsPage } from './pages/ProjectsPage.tsx';
import { ProjectDetailPage } from './pages/ProjectDetailPage.tsx';
import { RequirementsPage } from './pages/RequirementsPage.tsx';
import { ArchitecturePage } from './pages/ArchitecturePage.tsx';
import { DiagramEditorPage } from './pages/DiagramEditorPage.tsx';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/projects/:id" element={<ProjectDetailPage />} />
      <Route path="/projects/:id/requirements" element={<RequirementsPage />} />
      <Route path="/projects/:id/architecture" element={<ArchitecturePage />} />
      <Route path="/projects/:id/diagrams/:diagramId" element={<DiagramEditorPage />} />
    </Routes>
  );
}
