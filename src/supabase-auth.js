import { createClient } from "@supabase/supabase-js";

let supabase;

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required to verify access tokens");
  }
  supabase ||= createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return supabase;
}

export async function verifyAccessToken(accessToken) {
  const { data, error } = await getSupabaseClient().auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user;
}
