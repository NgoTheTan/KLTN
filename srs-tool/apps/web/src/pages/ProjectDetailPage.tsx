import { useParams } from 'react-router-dom';
export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <main><h1>Dự án {id}</h1>{/* TODO: Upload docs, start run, progress SSE */}</main>;
}
