// Screen-sharing labels only. Underlying data needs a separate hosting access policy.
// These rules emit fixed descriptions, never portions of a potentially private title.
// A label describes the recorded task, not a claim that its output was completed.
const DESCRIPTORS = [
  [/recruit.*(site|connection)/i, 'Recruiting connections site'],
  [/dashboard|usage/i, 'Usage dashboard'],
  [/research|analysis/i, 'Research and analysis'],
  [/meeting|agenda/i, 'Meeting preparation'],
  [/draft|email|message/i, 'Writing and review'],
  [/code|build|project/i, 'Project development']
];

function descriptiveName(title, startedAt) {
  const label = DESCRIPTORS.find(([pattern]) => pattern.test(title || ''))?.[1] || 'Recorded Codex work';
  const date = String(startedAt || '').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${label} · ${date}` : label;
}

export function presentationSnapshot(snapshot, annotations = {}) {
  const reviewedName = id => annotations[id]?.presentation_label?.trim();
  const names=new Map(snapshot.sessions.map(row=>[row.session_id,reviewedName(row.session_id) || descriptiveName(row.thread_name,row.session_started_at)]));
  const spaces=new Map(snapshot.workspaces.map((row,index)=>[row.workspace_key,`Workspace ${index+1}`]));
  return {...snapshot,workspaces:snapshot.workspaces.map(row=>({...row,workspace_label:spaces.get(row.workspace_key)})),
    sessions:snapshot.sessions.map(row=>({...row,thread_name:names.get(row.session_id),parent_thread_name:names.get(row.parent_session_id)||reviewedName(row.parent_session_id)||descriptiveName(row.parent_thread_name),
      agent_nickname:row.is_subagent?'Helper':'',workspace_label:spaces.get(row.workspace_key)||'Workspace'}))};
}
