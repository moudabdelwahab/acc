/* ============================================================
   supabase.js — Supabase client & data access layer
   Uses ONLY the public anon key. Never place service-role
   keys or secrets here — Row Level Security protects data.
   ============================================================ */

(function () {
  'use strict';

  /**
   * Project credentials are read from `window.APP_CONFIG` when present,
   * otherwise from the placeholders below. Replace these two values with
   * your own Supabase project URL and anon (public) key before deploying.
   */
  var SUPABASE_URL = (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL) || 'https://YOUR_PROJECT_REF.supabase.co';
  var SUPABASE_ANON_KEY = (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_ANON_KEY) || 'YOUR_SUPABASE_ANON_KEY';

  var client = null;

  function isConfigured() {
    return (
      typeof window.supabase !== 'undefined' &&
      SUPABASE_URL.indexOf('YOUR_PROJECT_REF') === -1 &&
      SUPABASE_ANON_KEY.indexOf('YOUR_SUPABASE_ANON_KEY') === -1
    );
  }

  function getClient() {
    if (client) return client;
    if (!isConfigured()) return null;
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return client;
  }

  /* ---------- Generic table helpers ---------- */

  /**
   * Fetch rows from a table.
   * options: { select, filters: [{col, op, val}], order: {col, ascending}, limit, from, to }
   */
  function fetchRows(table, options) {
    var sb = getClient();
    if (!sb) return Promise.resolve({ data: null, error: { message: 'SUPABASE_NOT_CONFIGURED' } });
    options = options || {};
    var q = sb.from(table).select(options.select || '*');
    (options.filters || []).forEach(function (f) {
      switch (f.op) {
        case 'eq': q = q.eq(f.col, f.val); break;
        case 'neq': q = q.neq(f.col, f.val); break;
        case 'gte': q = q.gte(f.col, f.val); break;
        case 'lte': q = q.lte(f.col, f.val); break;
        case 'ilike': q = q.ilike(f.col, f.val); break;
        case 'in': q = q.in(f.col, f.val); break;
        case 'is': q = q.is(f.col, f.val); break;
        case 'order': break;
      }
    });
    if (options.order) q = q.order(options.order.col, { ascending: options.order.ascending !== false });
    if (options.limit) q = q.limit(options.limit);
    if (typeof options.from === 'number' && typeof options.to === 'number') q = q.range(options.from, options.to);
    return q;
  }

  /**
   * Fetch ALL matching rows, 1000 at a time. Supabase caps every response at
   * 1000 rows (max_rows) and truncates silently, so any list or computation
   * that can grow past that must page. Pages are ordered by id as a
   * tie-breaker so no row is skipped or repeated between pages.
   */
  function fetchAll(table, options) {
    var PAGE = 1000;
    var all = [];
    function page(from) {
      var opts = Object.assign({}, options || {}, { from: from, to: from + PAGE - 1 });
      var q = fetchRows(table, opts);
      if (q && typeof q.order === 'function') q = q.order('id', { ascending: true });
      return q.then(function (res) {
        if (res.error) return { data: null, error: res.error };
        var rows = res.data || [];
        all = all.concat(rows);
        if (rows.length < PAGE) return { data: all, error: null };
        return page(from + PAGE);
      });
    }
    return page(0);
  }

  /** Call a database function (RPC). */
  function rpc(name, args) {
    var sb = getClient();
    if (!sb) return Promise.resolve({ data: null, error: { message: 'SUPABASE_NOT_CONFIGURED' } });
    return sb.rpc(name, args || {});
  }

  function insertRow(table, payload) {
    var sb = getClient();
    if (!sb) return Promise.resolve({ data: null, error: { message: 'SUPABASE_NOT_CONFIGURED' } });
    return sb.from(table).insert(payload).select();
  }

  function updateRow(table, id, payload) {
    var sb = getClient();
    if (!sb) return Promise.resolve({ data: null, error: { message: 'SUPABASE_NOT_CONFIGURED' } });
    return sb.from(table).update(payload).eq('id', id).select();
  }

  function deleteRow(table, id) {
    var sb = getClient();
    if (!sb) return Promise.resolve({ data: null, error: { message: 'SUPABASE_NOT_CONFIGURED' } });
    return sb.from(table).delete().eq('id', id);
  }

  /* ---------- Auth ---------- */

  function signIn(email, password) {
    var sb = getClient();
    if (!sb) return Promise.resolve({ data: null, error: { message: 'SUPABASE_NOT_CONFIGURED' } });
    return sb.auth.signInWithPassword({ email: email, password: password });
  }

  function signOut() {
    var sb = getClient();
    if (!sb) return Promise.resolve({ error: null });
    return sb.auth.signOut();
  }

  function getSession() {
    var sb = getClient();
    if (!sb) return Promise.resolve({ data: { session: null }, error: null });
    return sb.auth.getSession();
  }

  function resetPassword(email) {
    var sb = getClient();
    if (!sb) return Promise.resolve({ data: null, error: { message: 'SUPABASE_NOT_CONFIGURED' } });
    return sb.auth.resetPasswordForEmail(email);
  }

  window.db = {
    isConfigured: isConfigured,
    getClient: getClient,
    fetchRows: fetchRows,
    fetchAll: fetchAll,
    rpc: rpc,
    insertRow: insertRow,
    updateRow: updateRow,
    deleteRow: deleteRow,
    signIn: signIn,
    signOut: signOut,
    getSession: getSession,
    resetPassword: resetPassword
  };
})();
