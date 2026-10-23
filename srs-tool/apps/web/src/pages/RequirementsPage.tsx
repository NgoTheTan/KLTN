import { useParams } from 'react-router-dom';
export function RequirementsPage() {
  const { id } = useParams<{ id: string }>();
  return <main><h1>Yêu cầu — Dự án {id}</h1>{/* TODO: Requirement list, quality scores, coverage */}</main>;
}
