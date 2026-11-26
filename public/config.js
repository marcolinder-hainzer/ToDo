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
  supabaseUrl: 'https://hwobeeiahjmtiikdllwn.supabase.co',
  supabaseKey: 'sb_publishable_XlfFrLk3YVuD_iAvDGvvEQ_-mWqGS51',
  vapidPublicKey: 'BNaYWKnEtkuKMlkaoZ6rYQYe0DkJsRpdI6rTdgb3SVRkYsmSoqKY4z0WY-2U-BeJMkosf8actMQkUDZI_zSYkmA',
  loginDomain: 'todo.local',
};
