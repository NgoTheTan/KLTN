import { useParams } from 'react-router-dom';
export function DiagramEditorPage() {
  const { id, diagramId } = useParams<{ id: string; diagramId: string }>();
  return <main><h1>Sơ đồ {diagramId}</h1>{/* TODO: CodeMirror PlantUML editor, SVG preview, model/detached mode */}</main>;
}
