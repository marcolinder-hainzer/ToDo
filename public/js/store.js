import { api } from './api.js';
import { todayStr } from './dates.js';

export const AREAS = {
  work: { label: 'Beruflich', icon: 'briefcase', adjective: 'berufliches' },
  private: { label: 'Privat', icon: 'user', adjective: 'privates' },
};

export const PRIORITIES = [
  { value: 0, label: 'Niedrig' },
  { value: 1, label: 'Normal' },
  { value: 2, label: 'Hoch' },
];

export const store = {
  user: null,
  settings: null,
  projects: [],
};

export async function loadProjects() {
  store.projects = await api.get(`/api/projects?today=${todayStr()}`);
  window.dispatchEvent(new CustomEvent('projects:changed'));
  return store.projects;
}

export const projectById = (id) => store.projects.find((p) => p.id === id) || null;

/** Tell the current view (and sidebar) that data has changed. */
export function notifyChanged() {
  window.dispatchEvent(new CustomEvent('data:changed'));
}
