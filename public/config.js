/*
 * Verbindung zu Supabase. Diese Werte sind öffentlich (sie stehen in jedem Browser) –
 * geschützt werden die Daten durch Anmeldung und Row Level Security in der Datenbank.
 *
 *  supabaseUrl     Projekt-URL, z. B. https://abcdefghijkl.supabase.co
 *  supabaseKey     "Publishable key" (bzw. "anon public" Key) des Projekts
 *  vapidPublicKey  Öffentlicher Schlüssel für Push-Benachrichtigungen (optional)
 *  loginDomain     Interne Domain, aus "marco" wird "marco@todo.local" (nicht ändern, wenn schon Benutzer existieren)
 */
window.TODO_CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
  vapidPublicKey: '',
  loginDomain: 'todo.local',
};
