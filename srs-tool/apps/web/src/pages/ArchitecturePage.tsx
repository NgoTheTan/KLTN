import { useParams } from 'react-router-dom';
export function ArchitecturePage() {
  const { id } = useParams<{ id: string }>();
  return <main><h1>Kiến trúc — Dự án {id}</h1>{/* TODO: Model viewer, stack recommendations */}</main>;
}
