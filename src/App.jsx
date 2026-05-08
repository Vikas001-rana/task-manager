import { useEffect, useMemo, useState } from "react";
import { hasSupabase, supabase, supabaseUrl } from "./supabaseClient";
import adminPortal from "./adminPortal.json";
import memberPortal from "./memberPortal.json";

const uid = () => crypto.randomUUID?.() || Math.random().toString(36).slice(2, 10);
const MEMBERS = [];
const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || adminPortal.credentials.email;
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || adminPortal.credentials.password;
const ADMIN = { type: "admin", skill: adminPortal.role, name: adminPortal.name, email: ADMIN_EMAIL, avatar: "AD" };
const PORTAL_MODE = import.meta.env.VITE_PORTAL || "both";

function friendlyError(error) {
  let message = "";
  if (typeof error === "string") {
    message = error;
  } else if (error?.message && error.message !== "[object Object]") {
    message = error.message;
  } else if (error?.error_description) {
    message = error.error_description;
  } else if (error?.details || error?.hint || error?.code) {
    message = [error.code, error.details, error.hint].filter(Boolean).join(" - ");
  } else if (error && typeof error === "object") {
    try {
      message = JSON.stringify(error);
    } catch {
      message = "Something went wrong.";
    }
  } else {
    message = String(error || "");
  }
  if (message === "Failed to fetch" || message.includes("fetch")) {
    return `Cannot connect to Supabase from this browser. Check internet/VPN/firewall access to ${supabaseUrl}, then refresh the app.`;
  }
  return message === "{}" || message === "[object Object]" ? "Something went wrong. Check the browser console for details." : message;
}

function displayText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "object" && value.$$typeof) return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "Invalid value";
    }
  }
  return String(value);
}

const S = {
  get: (k, fb = null) => {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : fb;
    } catch {
      return fb;
    }
  },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

function initials(name = "") {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";
}

function seedLocalData() {
  if (S.get("dp_seeded")) return;
  S.set("dp_clients", []);
  S.set("dp_projects", []);
  S.set("dp_complaints", []);
  S.set("dp_seeded", true);
}

function normalizeLocalMembers() {
  const clients = S.get("dp_clients", []);
  if (!clients.length) return;
  const legacyOrgKey = ["com", "pany"].join("");
  const legacyDomain = ["@cli", "ent.com"].join("");
  const legacyPassword = ["cli", "ent123"].join("");
  const normalized = clients.map((member) => {
    const next = { ...member };
    delete next[legacyOrgKey];
    return {
      ...next,
      skill: next.skill || (next.role && next.role !== "client" ? next.role : "Team Member"),
      role: undefined,
      email: next.email?.replace(legacyDomain, "@member.com") || next.email,
      password: next.password === legacyPassword ? "member123" : next.password,
    };
  });
  S.set("dp_clients", normalized);
}

const fromDbProject = (p) => ({
  id: p.id,
  title: p.title,
  clientId: p.client_id,
  description: p.description || "",
  priority: p.priority,
  deadline: p.deadline,
  status: p.status,
  tasks: p.tasks || [],
  members: p.members || [],
  createdAt: p.created_at,
});

const toDbProject = (p) => ({
  title: p.title,
  client_id: p.clientId,
  description: p.description || "",
  priority: p.priority,
  deadline: p.deadline,
  status: p.status,
  tasks: p.tasks || [],
  members: p.members || [],
  created_at: p.createdAt || new Date().toISOString().slice(0, 10),
});

async function loadData() {
  if (!hasSupabase) {
    seedLocalData();
    normalizeLocalMembers();
    return { clients: S.get("dp_clients", []), projects: S.get("dp_projects", []), complaints: S.get("dp_complaints", []) };
  }

  const [{ data: clients, error: clientsError }, { data: projects, error: projectsError }, { data: complaints, error: complaintsError }] = await Promise.all([
    supabase.from("clients").select("*").order("created_at", { ascending: true }),
    supabase.from("projects").select("*").order("created_at", { ascending: false }),
    supabase.from("complaints").select("*").order("created_at", { ascending: false }),
  ]);
  if (clientsError) throw new Error(friendlyError(clientsError));
  if (projectsError) throw new Error(friendlyError(projectsError));
  if (complaintsError) throw new Error(friendlyError(complaintsError));
  return { clients: clients || [], projects: (projects || []).map(fromDbProject), complaints: complaints || [] };
}

async function createClientAccount(form) {
  const account = {
    name: form.name.trim(),
    email: form.email.trim().toLowerCase(),
    avatar: initials(form.name),
    skill: form.skill.trim(),
  };

  if (!hasSupabase) {
    const clients = S.get("dp_clients", []);
    if (clients.some((c) => c.email.toLowerCase() === account.email)) throw new Error("An account with this email already exists.");
    const created = { id: uid(), ...account, password: form.password };
    S.set("dp_clients", [...clients, created]);
    return { profile: created, session: { user: created } };
  }

  const { data: existingProfile, error: existingError } = await supabase.from("clients").select("id").eq("email", account.email).maybeSingle();
  if (existingError) throw new Error(friendlyError(existingError));
  if (existingProfile) throw new Error("This email is already registered. Please log in instead.");

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: account.email,
    password: form.password,
    options: {
      emailRedirectTo: window.location.origin,
      data: {
        name: account.name,
        skill: account.skill,
        avatar: account.avatar,
      },
    },
  });
  if (authError) throw new Error(friendlyError(authError));
  if (!authData.user) throw new Error("Could not create auth user.");

  const profile = { id: authData.user.id, ...account };
  if (!authData.session) return { profile, session: null };

  const { error: profileError } = await supabase.from("clients").upsert(profile, { onConflict: "email" }).select().single();
  if (profileError) throw new Error(friendlyError(profileError));
  return { profile, session: authData.session };
}

async function loginMemberAccount(email, password, clients) {
  const cleanEmail = email.trim().toLowerCase();

  if (!hasSupabase) {
    const client = clients.find((c) => c.email.toLowerCase() === cleanEmail && c.password === password);
    if (!client) throw new Error("Invalid member credentials.");
    return { ...client, type: "client" };
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
  if (error) throw new Error(friendlyError(error));
  const { data: profile, error: profileError } = await supabase.from("clients").select("*").eq("id", data.user.id).single();
  if (profileError) {
    const meta = data.user.user_metadata || {};
    const fallbackProfile = {
      id: data.user.id,
      name: meta.name || cleanEmail.split("@")[0],
      email: cleanEmail,
      avatar: meta.avatar || initials(meta.name || cleanEmail),
      skill: meta.skill || "Team Member",
    };
    const { data: createdProfile, error: createProfileError } = await supabase.from("clients").upsert(fallbackProfile, { onConflict: "email" }).select().single();
    if (createProfileError) throw new Error(friendlyError(createProfileError));
    return { ...createdProfile, type: "client" };
  }
  return { ...profile, type: "client" };
}

async function upsertProject(project, isCreate) {
  if (!hasSupabase) {
    const projects = S.get("dp_projects", []);
    const next = isCreate
      ? [{ ...project, id: uid(), createdAt: new Date().toISOString().slice(0, 10) }, ...projects]
      : projects.map((p) => (p.id === project.id ? project : p));
    S.set("dp_projects", next);
    return next;
  }

  if (isCreate) {
    const { error } = await supabase.from("projects").insert(toDbProject(project));
    if (error) throw new Error(friendlyError(error));
  } else {
    const { error } = await supabase.from("projects").update(toDbProject(project)).eq("id", project.id);
    if (error) throw new Error(friendlyError(error));
  }
  return null;
}

async function deleteProject(id) {
  if (!hasSupabase) {
    const next = S.get("dp_projects", []).filter((p) => p.id !== id);
    S.set("dp_projects", next);
    return next;
  }
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw new Error(friendlyError(error));
  return null;
}

async function updateMemberAccount(user, form) {
  const nextProfile = {
    name: form.name.trim(),
    avatar: form.avatar || initials(form.name),
  };

  if (!hasSupabase) {
    const clients = S.get("dp_clients", []);
    const current = clients.find((c) => c.id === user.id);
    if (!current) throw new Error("Member profile not found.");
    if (form.newPassword) {
      if (!form.oldPassword || current.password !== form.oldPassword) throw new Error("Old password is incorrect.");
      nextProfile.password = form.newPassword;
    }
    const nextClients = clients.map((c) => (c.id === user.id ? { ...c, ...nextProfile } : c));
    S.set("dp_clients", nextClients);
    return { ...current, ...nextProfile, type: "client" };
  }

  if (form.newPassword) {
    if (!form.oldPassword) throw new Error("Enter old password first.");
    const { error: loginError } = await supabase.auth.signInWithPassword({ email: user.email, password: form.oldPassword });
    if (loginError) throw new Error("Old password is incorrect.");
    const { error: passError } = await supabase.auth.updateUser({ password: form.newPassword });
    if (passError) throw new Error(friendlyError(passError));
  }

  const { data, error } = await supabase.from("clients").update(nextProfile).eq("id", user.id).select().single();
  if (error) throw new Error(friendlyError(error));
  await supabase.auth.updateUser({ data: { name: nextProfile.name, avatar: nextProfile.avatar, skill: user.skill } });
  return { ...data, type: "client" };
}

async function createComplaint(memberId, message, projectId) {
  const complaint = {
    member_id: memberId,
    project_id: projectId || null,
    message: message.trim(),
    reply: "",
    messages: [{ sender: "member", text: message.trim(), at: new Date().toISOString() }],
    created_at: new Date().toISOString(),
  };

  if (!hasSupabase) {
    const complaints = S.get("dp_complaints", []);
    const created = { id: uid(), ...complaint };
    S.set("dp_complaints", [created, ...complaints]);
    return created;
  }

  const { data, error } = await supabase.from("complaints").insert(complaint).select().single();
  if (error) throw new Error(friendlyError(error));
  return data;
}

async function updateComplaintReply(id, reply) {
  if (!hasSupabase) {
    const complaints = S.get("dp_complaints", []);
    const next = complaints.map((c) => {
      if (c.id !== id) return c;
      const baseMessages = c.messages?.length ? c.messages : [{ sender: "member", text: c.message, at: c.created_at }];
      const withoutOldReply = baseMessages.filter((m) => m.kind !== "initial_reply");
      return { ...c, reply, messages: [...withoutOldReply, { sender: "admin", text: reply, at: new Date().toISOString(), kind: "initial_reply" }] };
    });
    S.set("dp_complaints", next);
    return next;
  }

  const { data: current, error: readError } = await supabase.from("complaints").select("*").eq("id", id).single();
  if (readError) throw new Error(friendlyError(readError));
  const baseMessages = current.messages?.length ? current.messages : [{ sender: "member", text: current.message, at: current.created_at }];
  const withoutOldReply = baseMessages.filter((m) => m.kind !== "initial_reply");
  const messages = [...withoutOldReply, { sender: "admin", text: reply, at: new Date().toISOString(), kind: "initial_reply" }];
  const { error } = await supabase.from("complaints").update({ reply, messages }).eq("id", id);
  if (error) throw new Error(friendlyError(error));
  return null;
}

async function addComplaintMessage(id, sender, text) {
  const message = { sender, text: text.trim(), at: new Date().toISOString() };
  if (!hasSupabase) {
    const complaints = S.get("dp_complaints", []);
    const next = complaints.map((c) => {
      if (c.id !== id) return c;
      const messages = c.messages?.length ? c.messages : [{ sender: "member", text: c.message, at: c.created_at }];
      return { ...c, messages: [...messages, message] };
    });
    S.set("dp_complaints", next);
    return next;
  }

  const { data: current, error: readError } = await supabase.from("complaints").select("*").eq("id", id).single();
  if (readError) throw new Error(friendlyError(readError));
  const messages = current.messages?.length ? current.messages : [{ sender: "member", text: current.message, at: current.created_at }];
  const { error } = await supabase.from("complaints").update({ messages: [...messages, message] }).eq("id", id);
  if (error) throw new Error(friendlyError(error));
  return null;
}

const daysUntil = (d) => Math.ceil((new Date(`${d}T00:00`) - new Date()) / 86400000);
const fmtDate = (d) => (d ? new Date(`${d}T00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "No deadline");
const taskProgress = (tasks = []) => (tasks.length ? Math.round((tasks.filter((t) => t.status === "Done").length / tasks.length) * 100) : 0);
const priorityColor = { High: "#c0392b", Medium: "#b8650a", Low: "#1a6b4a" };
const displayMembers = (project, clients) => {
  const names = [...(project.members || [])];
  const client = clients.find((c) => c.id === project.clientId);
  if (client && !names.includes(client.name)) names.unshift(client.name);
  return names;
};
const memberProjects = (projects, member) => projects.filter((p) => p.clientId === member.id || (p.members || []).includes(member.name));
const projectStatusCounts = (projects = []) => ({
  completed: projects.filter((p) => p.status === "Done").length,
  inProgress: projects.filter((p) => p.status === "In Progress").length,
  toDo: projects.filter((p) => p.status === "To Do").length,
});
const taskStatusCounts = (tasks = []) => ({
  completed: tasks.filter((t) => t.status === "Done").length,
  inProgress: tasks.filter((t) => t.status === "In Progress").length,
  toDo: tasks.filter((t) => t.status === "To Do").length,
});
const memberWorkRows = (project, clients) => displayMembers(project, clients).map((name) => {
  const tasks = (project.tasks || []).filter((t) => t.assignedMember === name);
  const counts = taskStatusCounts(tasks);
  return { name, tasks, ...counts };
});

const css = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Crimson+Pro:wght@500;600&display=swap');
*{box-sizing:border-box}body{margin:0;font-family:Outfit,sans-serif;background:#f7f5f0;color:#1a1714}.auth-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.auth-right{width:100%;display:flex;align-items:center;justify-content:center}.auth-box{width:100%;max-width:420px;background:white;border:1.5px solid #e2ddd5;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.1);padding:30px}.auth-box h2{font-family:'Crimson Pro',serif;font-size:2rem;margin:0 0 6px}.portal-stack{display:flex;flex-direction:column;gap:12px;margin-top:22px}.portal-card{width:100%;border:1.5px solid #e2ddd5;background:#fff;border-radius:12px;padding:16px;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:4px;font:inherit}.portal-card strong{font-size:1rem}.portal-card span{color:#6b6560;font-size:.84rem}.portal-card.admin:hover{border-color:#d4521a;background:#fdf0ea}.portal-card.client:hover{border-color:#1a6b4a;background:#e8f5ef}.brand,.title,.sec-title,.modal-title{font-family:'Crimson Pro',serif}.brand{font-size:2rem;font-weight:600}.brand span{color:#d4521a}.muted{color:#6b6560}.portal-toggle{display:flex;background:#eeeae2;border-radius:10px;padding:4px;margin:24px 0}.ptab{flex:1;border:0;background:transparent;border-radius:8px;padding:10px;font:600 .86rem Outfit;cursor:pointer;color:#6b6560}.ptab.active.admin{background:#d4521a;color:white}.ptab.active.client{background:#1a6b4a;color:white}.form-group{margin:13px 0}.label{display:block;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6b6560;margin-bottom:6px}.inp,.sel,.ta{width:100%;border:1.5px solid #e2ddd5;border-radius:10px;background:white;padding:11px 13px;font:inherit;outline:none}.inp:focus,.sel:focus,.ta:focus{border-color:#d4521a}.ta{min-height:86px;resize:vertical}.btn{border:0;border-radius:10px;padding:11px 16px;font:700 .88rem Outfit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px}.btn-admin{background:#d4521a;color:white}.btn-client{background:#1a6b4a;color:white}.btn-ghost{background:white;border:1.5px solid #c8c3b8;color:#4f4944}.btn-danger{background:#fdecea;color:#c0392b;border:1px solid #f5c8c5}.btn-sm{padding:7px 12px;font-size:.78rem}.err{color:#c0392b;font-size:.82rem}.hint{font-size:.78rem;color:#8b8580;line-height:1.6;margin-top:12px}.shell{display:flex;min-height:100vh}.sidebar{width:260px;background:#1a1714;color:white;padding:24px 14px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh}.sidebar.client{background:#0f2a1e}.sb-logo{padding:0 10px 22px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:18px}.sb-sub{font-size:.7rem;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.1em}.sb-item{width:100%;border:0;background:transparent;color:rgba(255,255,255,.55);padding:10px 12px;border-radius:8px;text-align:left;font:600 .86rem Outfit;cursor:pointer;margin-bottom:5px}.sb-item.active,.sb-item:hover{background:rgba(212,82,26,.2);color:#f08060}.sidebar.client .sb-item.active,.sidebar.client .sb-item:hover{background:rgba(77,189,138,.16);color:#4dbd8a}.sb-footer{margin-top:auto;border-top:1px solid rgba(255,255,255,.08);padding-top:16px}.sb-user{display:flex;align-items:center;gap:10px}.main{flex:1;min-width:0}.topbar{height:68px;background:white;border-bottom:1.5px solid #e2ddd5;display:flex;align-items:center;justify-content:space-between;padding:0 30px;position:sticky;top:0;z-index:5}.topbar h1{font-family:'Crimson Pro',serif;margin:0}.content{padding:30px}.badge{border-radius:999px;padding:5px 11px;font-size:.72rem;font-weight:800;text-transform:uppercase}.badge.admin{background:#fdf0ea;color:#d4521a;border:1px solid #f5cbb8}.badge.client{background:#e8f5ef;color:#1a6b4a;border:1px solid #b8dfc9}.av{border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;color:white;background:#d4521a;flex:none}.av.client{background:#1a6b4a}.av.sm{width:30px;height:30px;font-size:.72rem}.av.md{width:40px;height:40px}.av.lg{width:54px;height:54px;font-size:1.1rem}.sec-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;gap:16px}.sec-title{font-size:1.45rem;margin:0}.card-title{font-family:'Crimson Pro',serif;font-size:1.15rem;margin:0}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:26px}.card,.stat,.proj-card,.client-proj{background:white;border:1.5px solid #e2ddd5;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.07)}.card{padding:22px}.card-sm{background:#f7f5f0;border:1px solid #e2ddd5;border-radius:10px;padding:14px}.stat{padding:18px}.stat-val{font-family:'Crimson Pro',serif;font-size:2.3rem;font-weight:600}.stat-lbl{font-size:.78rem;color:#6b6560}.proj-card{overflow:hidden}.proj-top{padding:18px;border-top:4px solid #d4521a;border-bottom:1.5px solid #e2ddd5}.proj-body{padding:16px 18px}.proj-title{font-family:'Crimson Pro',serif;font-size:1.2rem;font-weight:600;margin:8px 0}.desc{font-size:.84rem;color:#6b6560;line-height:1.55}.row{display:flex;align-items:center}.between{justify-content:space-between}.gap8{gap:8px}.gap12{gap:12px}.wrap{flex-wrap:wrap}.mt8{margin-top:8px}.mt12{margin-top:12px}.mb12{margin-bottom:12px}.mb16{margin-bottom:16px}.pri,.status,.deadline{display:inline-flex;align-items:center;border-radius:999px;padding:4px 9px;font-size:.72rem;font-weight:800}.pri.High{background:#fdecea;color:#c0392b}.pri.Medium{background:#fdf3e3;color:#b8650a}.pri.Low{background:#e8f5ef;color:#1a6b4a}.status.Done{background:#e8f5ef;color:#1a6b4a}.status.InProgress{background:#e8eef8;color:#1a4a8a}.status.ToDo{background:#f0ece4;color:#6b6560}.deadline{background:#eeeae2;color:#6b6560}.deadline.overdue{background:#fdecea;color:#c0392b}.deadline.soon{background:#fdf3e3;color:#b8650a}.progress-track{height:6px;background:#eeeae2;border-radius:4px;overflow:hidden;flex:1}.progress-fill{height:100%}table{width:100%;border-collapse:collapse}th{text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#a09b94;border-bottom:1.5px solid #e2ddd5;padding:9px}td{padding:12px 9px;border-bottom:1px solid #e2ddd5;font-size:.86rem}.overlay{position:fixed;inset:0;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:20px;z-index:20}.modal{width:100%;max-width:720px;max-height:90vh;overflow:auto;background:white;border-radius:16px;padding:28px;box-shadow:0 10px 34px rgba(0,0,0,.2)}.modal-title{font-size:1.55rem;margin:0 0 20px}.modal-footer{display:flex;justify-content:flex-end;gap:10px;border-top:1px solid #e2ddd5;padding-top:18px;margin-top:22px}.form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.tag-wrap,.task-editor{display:flex;flex-wrap:wrap;gap:8px}.tag,.task-edit-row,.task-row,.info-block{background:#f7f5f0;border:1px solid #e2ddd5;border-radius:10px}.tag{padding:5px 9px;font-size:.8rem}.tag-x{border:0;background:transparent;color:#c0392b;cursor:pointer;font-weight:800}.task-edit-row{display:flex;align-items:center;gap:8px;padding:8px}.task-edit-row span{flex:1}.mini-sel{border:1px solid #d8d1c8;border-radius:7px;padding:4px;background:white}.client-proj{overflow:hidden;margin-bottom:18px}.client-accent{height:4px}.client-body{padding:22px}.info-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.info-block{padding:13px}.info-label{font-size:.68rem;color:#8e8882;text-transform:uppercase;letter-spacing:.08em;font-weight:800}.info-value{font-weight:800;margin-top:5px}.task-list{display:flex;flex-direction:column;gap:8px}.task-row{display:flex;align-items:center;gap:10px;padding:10px 12px}.task-name{flex:1}.done-text{text-decoration:line-through;color:#777}.empty{text-align:center;padding:42px;color:#777}.notice{background:#fff8e8;border:1px solid #efd89c;color:#795514;border-radius:12px;padding:10px 12px;margin-bottom:18px;font-size:.86rem}@media(max-width:980px){.grid3,.info-grid{grid-template-columns:1fr}.stat-row{grid-template-columns:repeat(2,1fr)}}@media(max-width:680px){.sidebar{display:none}.content{padding:16px}.form-row,.grid2{grid-template-columns:1fr}.topbar{padding:0 16px}.stat-row{grid-template-columns:1fr}.auth-box{padding:22px}}
`;

function Avatar({ name, avatar, type = "admin", size = "md" }) {
  const isImage = typeof avatar === "string" && avatar.startsWith("data:image");
  return <div className={`av ${type === "client" ? "client" : ""} ${size}`}>{isImage ? <img src={avatar} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} /> : initials(name)}</div>;
}

function Priority({ value }) {
  return <span className={`pri ${value}`}>{value}</span>;
}

function Status({ value }) {
  return <span className={`status ${value.replaceAll(" ", "")}`}>{value}</span>;
}

function Deadline({ date }) {
  if (!date) return <span className="deadline">No deadline</span>;
  const days = daysUntil(date);
  const cls = days < 0 ? "overdue" : days <= 7 ? "soon" : "";
  const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today" : `${days}d left`;
  return <span className={`deadline ${cls}`}>{fmtDate(date)} · {label}</span>;
}

function AuthScreen({ clients, onLogin, onSignup }) {
  const fixedPortal = PORTAL_MODE === "admin" || PORTAL_MODE === "member" ? (PORTAL_MODE === "member" ? "client" : "admin") : null;
  const [portal, setPortal] = useState(fixedPortal);
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", skill: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const login = async () => {
    setErr("");
    if (portal === "admin") {
      if (form.email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase() && form.password === ADMIN_PASSWORD) onLogin(ADMIN);
      else setErr("Invalid admin credentials.");
      return;
    }
    setBusy(true);
    try {
      const member = await loginMemberAccount(form.email, form.password, clients);
      onLogin(member);
    } catch (error) {
      setErr(friendlyError(error) || "Invalid member credentials.");
    } finally {
      setBusy(false);
    }
  };

  const signup = async () => {
    setErr("");
    if (!form.name.trim() || !form.skill.trim() || !form.email.trim() || !form.password) {
      setErr("Name, skill, email, and password are required.");
      return;
    }
    const cleanEmail = form.email.trim().toLowerCase();
    if (clients.some((c) => c.email?.toLowerCase() === cleanEmail)) {
      setErr("This email is already registered. Please log in instead.");
      return;
    }
    setBusy(true);
    try {
      const created = await onSignup(form);
      if (created.session) onLogin({ ...created.profile, type: "client" });
      else {
        setErr("Verification email sent. Please confirm your email, then log in.");
        setMode("login");
      }
    } catch (error) {
      setErr(friendlyError(error) || "Could not create account.");
    } finally {
      setBusy(false);
    }
  };

  const submit = mode === "signup" ? signup : login;
  const openPortal = (nextPortal) => {
    setPortal(fixedPortal || nextPortal);
    setMode("login");
    setErr("");
    setForm({ name: "", email: "", password: "", skill: "" });
  };

  return (
    <div className="auth-wrap">
      <div className="auth-right">
        <div className="auth-box">
          {!portal && (
            <>
              <h2>Select Portal</h2>
              <p className="muted">Admin and member access are separated. Both portals use the same Supabase database.</p>
              <div className="portal-stack">
                <button className="portal-card admin" onClick={() => openPortal("admin")}>
                  <strong>Admin Portal</strong>
                  <span>Manager sign in only</span>
                </button>
                <button className="portal-card client" onClick={() => openPortal("client")}>
                  <strong>Member Portal</strong>
                  <span>Member login and account creation</span>
                </button>
              </div>
            </>
          )}
          {portal && (
            <>
              {!fixedPortal && <button className="btn btn-ghost btn-sm mb16" onClick={() => openPortal(null)}>Back</button>}
              <h2>{portal === "admin" ? adminPortal.authTitle : mode === "signup" ? memberPortal.signupTitle : memberPortal.loginTitle}</h2>
              <p className="muted">{portal === "admin" ? adminPortal.authSubtitle : mode === "signup" ? memberPortal.signupSubtitle : memberPortal.loginSubtitle}</p>
            </>
          )}
          {portal === "client" && (
            <div className="row gap8 mb12">
              <button className={`btn btn-sm ${mode === "login" ? "btn-client" : "btn-ghost"}`} onClick={() => setMode("login")}>Login</button>
              <button className={`btn btn-sm ${mode === "signup" ? "btn-client" : "btn-ghost"}`} onClick={() => setMode("signup")}>Create Account</button>
            </div>
          )}
          {portal === "client" && mode === "signup" && (
            <>
              <div className="form-group"><label className="label">Member Name</label><input className="inp" value={form.name} onChange={(e) => update("name", e.target.value)} /></div>
              <div className="form-group"><label className="label">Skill</label><input className="inp" value={form.skill} onChange={(e) => update("skill", e.target.value)} placeholder="Write the skill you are good at" /></div>
            </>
          )}
          {portal && (
            <>
              <div className="form-group"><label className="label">Email</label><input className="inp" type="email" value={form.email} onChange={(e) => update("email", e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} /></div>
              <div className="form-group"><label className="label">Password</label><input className="inp" type="password" value={form.password} onChange={(e) => update("password", e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} /></div>
            </>
          )}
          {err && <p className="err">{err}</p>}
          {portal && <button className={`btn ${portal === "admin" ? "btn-admin" : "btn-client"}`} style={{ width: "100%", marginTop: 10 }} onClick={submit} disabled={busy}>{busy ? "Please wait..." : mode === "signup" ? "Create Account" : `Sign In to ${portal === "admin" ? "Admin" : "Member"}`}</button>}
          {portal === "client" && <p className="hint">New member accounts are saved in {hasSupabase ? "Supabase" : "localStorage until Supabase env vars are set"}.</p>}
        </div>
      </div>
    </div>
  );
}

function AdminOverview({ projects, clients }) {
  const allTasks = projects.flatMap((p) => p.tasks || []);
  const overdue = projects.filter((p) => daysUntil(p.deadline) < 0 && p.status !== "Done").length;
  return (
    <>
      <div className="sec-head"><h2 className="sec-title">Overview</h2></div>
      <div className="stat-row">
        <Stat value={projects.length} label="Total Projects" />
        <Stat value={allTasks.filter((t) => t.status === "In Progress").length} label="In Progress" />
        <Stat value={allTasks.filter((t) => t.status === "Done").length} label="Tasks Done" />
        <Stat value={overdue} label="Overdue Projects" />
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Project</th><th>Team Members</th><th>Priority</th><th>Deadline</th><th>Status</th><th>Progress</th></tr></thead>
          <tbody>
            {projects.map((p) => {
              const pct = taskProgress(p.tasks);
              return (
                <tr key={p.id}>
                  <td><strong>{p.title}</strong><div className="muted">{displayMembers(p, clients).length} members</div></td>
                  <td>{displayMembers(p, clients).join(", ") || "No members"}</td>
                  <td><Priority value={p.priority} /></td>
                  <td><Deadline date={p.deadline} /></td>
                  <td><Status value={p.status} /></td>
                  <td><Progress pct={pct} color={priorityColor[p.priority]} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({ value, label }) {
  return <div className="stat"><div className="stat-val">{value}</div><div className="stat-lbl">{label}</div></div>;
}

function Progress({ pct, color }) {
  return <div className="row gap8"><div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%`, background: color }} /></div><strong>{pct}%</strong></div>;
}

function AdminProjects({ projects, clients, complaints, onReply, onMessage, onSave, onDelete }) {
  const [modal, setModal] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [form, setForm] = useState({});
  const [newMember, setNewMember] = useState("");
  const [newTask, setNewTask] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const memberOptions = [
    ...clients.map((c) => ({ value: c.name, label: `${c.name} (${c.skill || c.role || "Team Member"})`, type: "member" })),
    ...MEMBERS.map((m) => ({ value: m, label: m, type: "staff" })),
  ];

  const openCreate = () => {
    setForm({ title: "", description: "", clientId: "", priority: "Medium", deadline: "", status: "To Do", members: [], tasks: [] });
    setErr("");
    setModal("create");
  };

  const openEdit = (p) => {
    setForm({ ...p, members: displayMembers(p, clients), tasks: (p.tasks || []).map((t) => ({ ...t })) });
    setErr("");
    setModal("edit");
  };

  const save = async () => {
    setErr("");
    if (!form.title?.trim()) return setErr("Project title is required.");
    const selectedMembers = clients.filter((c) => (form.members || []).includes(c.name));
    const selectedClient = selectedMembers[0];
    if (!selectedClient) return setErr("Add at least one real member account in Team Members.");
    if (!form.deadline) return setErr("Deadline is required.");
    setBusy(true);
    try {
      await onSave({ ...form, clientId: selectedClient.id, members: [...new Set(form.members || [])], status: modal === "create" ? "To Do" : form.status }, modal === "create");
      setModal(null);
    } catch (error) {
      setErr(friendlyError(error) || "Could not save project.");
    } finally {
      setBusy(false);
    }
  };

  const addMember = () => {
    if (!newMember || form.members.includes(newMember)) return;
    setForm((f) => ({ ...f, members: [...f.members, newMember] }));
    setNewMember("");
  };
  const addTask = () => {
    if (!newTask.trim()) return;
    setForm((f) => ({ ...f, tasks: [...f.tasks, { id: uid(), title: newTask.trim(), status: "To Do", assignedMember: f.members[0] || "" }] }));
    setNewTask("");
  };

  return (
    <>
      <div className="sec-head"><h2 className="sec-title">Projects</h2><button className="btn btn-admin btn-sm" onClick={openCreate}>+ Assign New Project</button></div>
      {clients.length === 0 && <div className="notice">Create at least one team member account before assigning projects.</div>}
      <div className="grid3">
        {projects.map((p) => {
          const pct = taskProgress(p.tasks);
          const members = displayMembers(p, clients);
          return (
            <div className="proj-card" key={p.id} onClick={() => setSelectedProject(p)} style={{ cursor: "pointer" }}>
              <div className="proj-top" style={{ borderTopColor: priorityColor[p.priority] }}>
                <div className="row between"><Priority value={p.priority} /><Status value={p.status} /></div>
                <div className="proj-title">{p.title}</div>
                <div className="desc">{p.description}</div>
                <div className="mt12"><Deadline date={p.deadline} /></div>
                <div className="mt12"><Progress pct={pct} color={priorityColor[p.priority]} /></div>
              </div>
              <div className="proj-body">
                <div className="tag-wrap mb12">{members.map((m) => <span className="tag" key={m}>{m}</span>)}</div>
                <div className="row between"><span className="muted">{members.length} members</span><span className="muted">{p.tasks?.filter((t) => t.status === "Done").length || 0}/{p.tasks?.length || 0} tasks</span></div>
                <div className="row gap8 mt12"><button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(p); }}>Edit</button><button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}>Remove</button></div>
              </div>
            </div>
          );
        })}
      </div>
      {selectedProject && (
        <ProjectDetailModal
          project={selectedProject}
          clients={clients}
          complaints={complaints}
          onReply={onReply}
          onMessage={onMessage}
          onClose={() => setSelectedProject(null)}
        />
      )}
      {modal && (
        <div className="overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">{modal === "create" ? "Assign New Project" : "Edit Project"}</h2>
            <div className="form-group"><label className="label">Project Title *</label><input className="inp" value={form.title || ""} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></div>
            <div className="form-group"><label className="label">Description</label><textarea className="ta" value={form.description || ""} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
            <div className="form-row">
              <div className="form-group"><label className="label">Priority</label><select className="sel" value={form.priority || "Medium"} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}><option>High</option><option>Medium</option><option>Low</option></select></div>
              <div className="form-group"><label className="label">Deadline *</label><input className="inp" type="date" value={form.deadline || ""} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} /></div>
            </div>
            {modal !== "create" && <div className="form-row">
              <div className="form-group"><label className="label">Status</label><select className="sel" value={form.status || "To Do"} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}><option>To Do</option><option>In Progress</option><option>Done</option></select></div>
            </div>}
            <div className="form-group"><label className="label">Team Members *</label><div className="row gap8"><select className="sel" value={newMember} onChange={(e) => setNewMember(e.target.value)}><option value="">Select member</option>{memberOptions.filter((m) => !(form.members || []).includes(m.value)).map((m) => <option key={`${m.type}-${m.value}`} value={m.value}>{m.label}</option>)}</select><button className="btn btn-ghost btn-sm" onClick={addMember}>Add</button></div><div className="tag-wrap mt8">{(form.members || []).map((m) => <span className="tag" key={m}>{m} <button className="tag-x" onClick={() => setForm((f) => ({ ...f, members: f.members.filter((x) => x !== m) }))}>x</button></span>)}</div><p className="hint">Add the member account here. That member will see this project in their portal.</p></div>
            <div className="form-group"><label className="label">Tasks</label><div className="task-editor">{(form.tasks || []).map((t) => <div className="task-edit-row" key={t.id}><span>{t.title}</span><select className="mini-sel" value={t.assignedMember || ""} onChange={(e) => setForm((f) => ({ ...f, tasks: f.tasks.map((x) => x.id === t.id ? { ...x, assignedMember: e.target.value } : x) }))}><option value="">Unassigned</option>{(form.members || []).map((m) => <option key={m}>{m}</option>)}</select><select className="mini-sel" value={t.status} onChange={(e) => setForm((f) => ({ ...f, tasks: f.tasks.map((x) => x.id === t.id ? { ...x, status: e.target.value } : x) }))}><option>To Do</option><option>In Progress</option><option>Done</option></select><button className="tag-x" onClick={() => setForm((f) => ({ ...f, tasks: f.tasks.filter((x) => x.id !== t.id) }))}>x</button></div>)}</div><div className="row gap8 mt8"><input className="inp" value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTask()} placeholder="New task title" /><button className="btn btn-ghost btn-sm" onClick={addTask}>+ Add</button></div></div>
            {err && <p className="err">{err}</p>}
            <div className="modal-footer"><button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-admin" onClick={save} disabled={busy}>{busy ? "Saving..." : "Save"}</button></div>
          </div>
        </div>
      )}
    </>
  );
}

function ProjectDetailModal({ project, clients, complaints, onReply, onMessage, onClose }) {
  const members = displayMembers(project, clients);
  const workRows = memberWorkRows(project, clients);
  const assignedMemberIds = clients.filter((c) => members.includes(c.name)).map((c) => c.id);
  const projectComplaints = complaints.filter((c) => c.project_id === project.id || (!c.project_id && assignedMemberIds.includes(c.member_id)));
  const counts = taskStatusCounts(project.tasks || []);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row between mb16">
          <div>
            <h2 className="modal-title" style={{ marginBottom: 4 }}>{project.title}</h2>
            <div className="row gap8 wrap"><Priority value={project.priority} /><Status value={project.status} /><Deadline date={project.deadline} /></div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        <p className="desc mb16">{project.description || "No description provided."}</p>
        <div className="info-grid mb16">
          <Info label="Completed" value={counts.completed} sub="Tasks done" />
          <Info label="In Progress" value={counts.inProgress} sub="Tasks active" />
          <Info label="To Do" value={counts.toDo} sub="Tasks pending" />
          <Info label="Complaints" value={projectComplaints.length} sub="Raised by assigned members" />
        </div>
        <h3 className="card-title">Member Work</h3>
        <div className="task-list mt12 mb16">
          {workRows.map((m) => (
            <div className="task-row" key={m.name}>
              <span className="task-name"><strong>{m.name}</strong><span className="muted"> · {m.tasks.length} tasks</span></span>
              <span className="status Done">{m.completed} completed</span>
              <span className="status InProgress">{m.inProgress} in progress</span>
              <span className="status ToDo">{m.toDo} to do</span>
            </div>
          ))}
        </div>
        <h3 className="card-title">Project Complaints</h3>
        <div className="task-list mt12">
          {projectComplaints.length === 0 && <div className="task-row"><span className="muted">No complaints for this project.</span></div>}
          {projectComplaints.map((c) => {
            const member = clients.find((m) => m.id === c.member_id);
            return <ProjectComplaintReply key={c.id} complaint={c} memberName={member?.name || "Member"} onReply={onReply} onMessage={onMessage} />;
          })}
        </div>
      </div>
    </div>
  );
}

function ProjectComplaintReply({ complaint, memberName, onReply, onMessage }) {
  const [reply, setReply] = useState(complaint.reply || "");
  const [msg, setMsg] = useState("");
  const [chatText, setChatText] = useState("");

  const save = async () => {
    setMsg("");
    if (!reply.trim()) return;
    await onReply(complaint.id, reply);
    setMsg("Reply sent.");
  };

  const sendChat = async () => {
    if (!chatText.trim()) return;
    await onMessage(complaint.id, "admin", chatText);
    setChatText("");
  };

  return (
    <div className="card-sm">
      <div className="row between mb12"><strong>{memberName}</strong><span className="muted">{complaint.reply ? "Replied" : "Waiting for reply"}</span></div>
      <p className="muted">{complaint.message}</p>
      {!complaint.reply ? (
        <>
          <div className="form-group"><label className="label">Admin Reply</label><textarea className="ta" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write reply to member" /></div>
          <div className="row gap8"><button className="btn btn-admin btn-sm" onClick={save}>Send Reply</button>{msg && <span className="hint">{msg}</span>}</div>
        </>
      ) : (
        <ChatThread complaint={complaint} inputValue={chatText} onInput={setChatText} onSend={sendChat} buttonClass="btn-admin" />
      )}
    </div>
  );
}

function ChatThread({ complaint, inputValue, onInput, onSend, buttonClass }) {
  const messages = complaint.messages?.length ? complaint.messages : [
    { sender: "member", text: complaint.message, at: complaint.created_at },
    ...(complaint.reply ? [{ sender: "admin", text: complaint.reply, at: complaint.created_at }] : []),
  ];

  return (
    <div className="mt12">
      <div className="task-list">
        {messages.map((m, i) => (
          <div className="task-row" key={`${m.at || i}-${i}`}>
            <span className="badge client">{m.sender === "admin" ? "Admin" : "Member"}</span>
            <span className="task-name">{m.text}</span>
          </div>
        ))}
      </div>
      <div className="row gap8 mt12">
        <input className="inp" value={inputValue} onChange={(e) => onInput(e.target.value)} placeholder="Write chat message" onKeyDown={(e) => e.key === "Enter" && onSend()} />
        <button className={`btn ${buttonClass} btn-sm`} onClick={onSend}>Send</button>
      </div>
    </div>
  );
}

function AdminClients({ clients, projects }) {
  const [selected, setSelected] = useState(null);
  const selectedProjects = selected ? memberProjects(projects, selected) : [];
  const selectedTasks = selectedProjects.flatMap((p) => p.tasks || []);
  const selectedProjectCounts = projectStatusCounts(selectedProjects);

  return (
    <>
      <div className="sec-head"><h2 className="sec-title">Team Members</h2><span className="badge client">{clients.length} accounts</span></div>
      <div className="grid3">
        {clients.map((c) => {
          const cProjects = memberProjects(projects, c);
          const tasks = cProjects.flatMap((p) => p.tasks || []);
          return (
            <div className="card" key={c.id} onClick={() => setSelected(c)} style={{ cursor: "pointer" }}>
              <div className="row gap12 mb16"><Avatar name={c.name} avatar={c.avatar} type="client" size="lg" /><div><strong>{c.name}</strong><div className="muted">{c.email}</div><span className="badge client">{c.skill || c.role || "Team Member"}</span></div></div>
              <div className="grid2"><Stat value={cProjects.length} label="Projects" /><Stat value={`${tasks.filter((t) => t.status === "Done").length}/${tasks.length}`} label="Tasks Done" /></div>
              <p className="hint">Click to view progress.</p>
            </div>
          );
        })}
      </div>
      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row between mb16">
              <div className="row gap12">
                <Avatar name={selected.name} avatar={selected.avatar} type="client" size="lg" />
                <div>
                  <h2 className="modal-title" style={{ marginBottom: 4 }}>{selected.name}</h2>
                  <div className="muted">{selected.email}</div>
                  <span className="badge client">{selected.skill || selected.role || "Team Member"}</span>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>Close</button>
            </div>
            <div className="grid2 mb16">
              <Stat value={selectedProjects.length} label="Assigned Projects" />
              <Stat value={`${selectedTasks.filter((t) => t.status === "Done").length}/${selectedTasks.length}`} label="Tasks Done" />
            </div>
            <div className="info-grid mb16">
              <Info label="Completed" value={selectedProjectCounts.completed} sub="Projects done" />
              <Info label="In Progress" value={selectedProjectCounts.inProgress} sub="Projects active" />
              <Info label="To Do" value={selectedProjectCounts.toDo} sub="Projects pending" />
              <Info label="Tasks" value={selectedTasks.length} sub="Assigned task count" />
            </div>
            <h3 className="card-title">Assigned Projects</h3>
            <div className="task-list mt12 mb16">
              {selectedProjects.length === 0 && <div className="task-row"><span className="muted">No projects assigned.</span></div>}
              {selectedProjects.map((p) => <div className="task-row" key={p.id}><span className="task-name">{p.title}</span><Status value={p.status} /><span className="muted">{taskProgress(p.tasks)}%</span></div>)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ClientView({ user, projects, complaints, projectFilter, onNavigate, onComplaint, onMessage, onProjectStatus }) {
  const [complaintText, setComplaintText] = useState("");
  const [complaintProjectId, setComplaintProjectId] = useState("");
  const [complaintMsg, setComplaintMsg] = useState("");
  const [newProject, setNewProject] = useState(null);
  const [dateFilter, setDateFilter] = useState("all");
  const [sortMode, setSortMode] = useState("nearest");
  const myProjects = memberProjects(projects, user);
  const tasks = myProjects.flatMap((p) => (p.tasks || []).filter((t) => t.assignedMember === user.name));
  const overdue = myProjects.filter((p) => daysUntil(p.deadline) < 0 && p.status !== "Done").length;
  const projectCounts = projectStatusCounts(myProjects);
  const taskCounts = taskStatusCounts(tasks);
  const myComplaints = complaints.filter((c) => c.member_id === user.id);
  const statusProjects = projectFilter === "all" ? myProjects : myProjects.filter((p) => p.status === projectFilter);
  const canDateFilter = projectFilter === "all" || projectFilter === "To Do";
  const dateFilteredProjects = canDateFilter
    ? statusProjects.filter((p) => {
        const days = daysUntil(p.deadline);
        if (dateFilter === "near") return days >= 0 && days <= 7;
        if (dateFilter === "overdue") return days < 0;
        return true;
      })
    : statusProjects;
  const filteredProjects = [...dateFilteredProjects].sort((a, b) => {
    if (sortMode === "latest") return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    if (sortMode === "oldest") return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    return new Date(`${a.deadline}T00:00`) - new Date(`${b.deadline}T00:00`);
  });
  const inProgressProjects = myProjects.filter((p) => p.status === "In Progress");
  const seenKey = `dp_seen_assignments_${user.id}`;

  useEffect(() => {
    const seen = S.get(seenKey, []);
    const unseen = myProjects.find((p) => p.status === "To Do" && !seen.includes(p.id));
    if (unseen) setNewProject(unseen);
  }, [seenKey, myProjects.map((p) => `${p.id}:${p.status}`).join("|")]);

  const markAssignmentSeen = (projectId) => {
    const seen = S.get(seenKey, []);
    if (!seen.includes(projectId)) S.set(seenKey, [...seen, projectId]);
    setNewProject(null);
  };

  const viewNewProject = () => {
    if (!newProject) return;
    markAssignmentSeen(newProject.id);
    onNavigate("To Do");
  };

  const sendComplaint = async () => {
    setComplaintMsg("");
    if (!complaintText.trim()) {
      setComplaintMsg("Write your complaint before sending.");
      return;
    }
    await onComplaint(complaintText, complaintProjectId);
    setComplaintText("");
    setComplaintProjectId("");
    setComplaintMsg("Complaint sent to admin.");
  };

  return (
    <>
      <div className="sec-head"><div><h2 className="sec-title">My Projects</h2><p className="muted">Projects assigned to {user.name}</p></div><span className="badge client">{user.skill || user.role || "Team Member"}</span></div>
      {projectFilter === "all" && <div className="stat-row"><Stat value={myProjects.length} label="My Projects" /><Stat value={projectCounts.inProgress} label="In Progress" /><Stat value={projectCounts.completed} label="Completed" /><Stat value={projectCounts.toDo} label="To Do" /></div>}
      {projectFilter === "all" && (
        <div className="card mb16">
          <h3 className="card-title">My Progress</h3>
          <div className="info-grid mt12">
            <Info label="Completed" value={taskCounts.completed} sub="My tasks done" />
            <Info label="In Progress" value={taskCounts.inProgress} sub="My tasks active" />
            <Info label="To Do" value={taskCounts.toDo} sub="My tasks not started" />
            <Info label="Overdue" value={overdue} sub="Projects past deadline" />
          </div>
        </div>
      )}
      {projectFilter === "In Progress" && (
        <div className="card">
          <h3 className="card-title">Complaint Box</h3>
          <div className="form-group"><label className="label">Related Project</label><select className="sel" value={complaintProjectId} onChange={(e) => setComplaintProjectId(e.target.value)}><option value="">General complaint</option>{inProgressProjects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
          <div className="form-group"><label className="label">Problem Details</label><textarea className="ta" value={complaintText} onChange={(e) => setComplaintText(e.target.value)} placeholder="Write your problem for admin" /></div>
          {complaintMsg && <p className="hint">{complaintMsg}</p>}
          <button className="btn btn-client btn-sm" onClick={sendComplaint}>Send Complaint</button>
          {myComplaints.length > 0 && <div className="task-list mt12">{myComplaints.map((c) => <MemberComplaintChat key={c.id} complaint={c} onMessage={onMessage} />)}</div>}
        </div>
      )}
      {canDateFilter && myProjects.length > 0 && (
        <div className="card mb16">
          <div className="form-row">
            <div className="form-group">
              <label className="label">Date Filter</label>
              <select className="sel" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
                <option value="all">All projects</option>
                <option value="near">Deadline near - next 7 days</option>
                <option value="overdue">Overdue projects</option>
              </select>
            </div>
            <div className="form-group">
              <label className="label">Sort By</label>
              <select className="sel" value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                <option value="nearest">Nearest deadline first</option>
                <option value="latest">Latest assigned first</option>
                <option value="oldest">Oldest assigned first</option>
              </select>
            </div>
          </div>
        </div>
      )}
      {myProjects.length === 0 && <div className="card empty">No projects assigned yet. After admin assigns a project to this member account, it will appear here.</div>}
      {myProjects.length > 0 && filteredProjects.length === 0 && <div className="card empty">No {projectFilter === "Done" ? "completed" : projectFilter.toLowerCase()} projects here.</div>}
      {filteredProjects.map((p) => {
        const myTasks = (p.tasks || []).filter((t) => t.assignedMember === user.name);
        const pct = taskProgress(myTasks);
        const counts = taskStatusCounts(myTasks);
        return (
          <div className="client-proj" key={p.id}>
            <div className="client-accent" style={{ background: priorityColor[p.priority] }} />
            <div className="client-body">
              <div className="row between wrap mb12"><div className="row gap8"><Priority value={p.priority} /><Status value={p.status} /></div><Deadline date={p.deadline} /></div>
              <h2 className="proj-title">{p.title}</h2>
              <p className="desc">{p.description || "No description provided."}</p>
              <div className="info-grid mb16">
                <Info label="Deadline" value={fmtDate(p.deadline)} sub={`${daysUntil(p.deadline)} days remaining`} />
                <Info label="Priority" value={`${p.priority} Priority`} sub="Set by admin" />
                <Info label="My Tasks" value={myTasks.length} sub="Assigned to me" />
                <Info label="My Progress" value={`${pct}% Complete`} sub={<Progress pct={pct} color={priorityColor[p.priority]} />} />
              </div>
              {projectFilter === "all" && (
                <div className="info-grid mb16">
                  <Info label="Completed" value={counts.completed} sub="Tasks done" />
                  <Info label="In Progress" value={counts.inProgress} sub="Tasks active" />
                  <Info label="To Do" value={counts.toDo} sub="Tasks pending" />
                  <Info label="Project Status" value={p.status} sub="Current project state" />
                </div>
              )}
              <div className="task-list">
                {myTasks.length === 0 && <div className="task-row"><span className="muted">No tasks assigned to you in this project.</span></div>}
                {myTasks.map((t) => <div className="task-row" key={t.id}><span className={`task-name ${t.status === "Done" ? "done-text" : ""}`}>{t.title}</span><Status value={t.status} /></div>)}
              </div>
              {p.status === "To Do" && <button className="btn btn-client btn-sm mt12" onClick={() => onProjectStatus(p, "In Progress")}>Accepted</button>}
              {p.status === "In Progress" && <button className="btn btn-client btn-sm mt12" onClick={() => onProjectStatus(p, "Done")}>Project Finished</button>}
            </div>
          </div>
        );
      })}
      {newProject && (
        <div className="overlay" onClick={() => markAssignmentSeen(newProject.id)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">New Project Assigned</h2>
            <div className="row gap8 wrap mb12">
              <Priority value={newProject.priority} />
              <Status value={newProject.status} />
              <Deadline date={newProject.deadline} />
            </div>
            <h3 className="proj-title">{newProject.title}</h3>
            <p className="desc">{newProject.description || "No description provided."}</p>
            <div className="info-grid mb16">
              <Info label="Deadline" value={fmtDate(newProject.deadline)} sub="Assigned by admin" />
              <Info label="Priority" value={`${newProject.priority} Priority`} sub="Project urgency" />
              <Info label="My Tasks" value={(newProject.tasks || []).filter((t) => t.assignedMember === user.name).length} sub="Assigned to you" />
              <Info label="Status" value="To Do" sub="Waiting to start" />
            </div>
            <h3 className="card-title">Your Tasks</h3>
            <div className="task-list mt12">
              {(newProject.tasks || []).filter((t) => t.assignedMember === user.name).length === 0 && <div className="task-row"><span className="muted">No task details assigned yet.</span></div>}
              {(newProject.tasks || []).filter((t) => t.assignedMember === user.name).map((task) => (
                <div className="task-row" key={task.id}>
                  <span className="task-name">{task.title}</span>
                  <Status value={task.status} />
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => markAssignmentSeen(newProject.id)}>Close</button>
              <button className="btn btn-client" onClick={viewNewProject}>View</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MemberComplaintChat({ complaint, onMessage }) {
  const [open, setOpen] = useState(false);
  const [chatText, setChatText] = useState("");

  const send = async () => {
    if (!chatText.trim()) return;
    await onMessage(complaint.id, "member", chatText);
    setChatText("");
  };

  return (
    <div className="card-sm">
      <div className="row between mb12">
        <span className="task-name">{complaint.message}</span>
        <span className="muted">{complaint.reply ? "Admin replied" : "Waiting for reply"}</span>
      </div>
      {complaint.reply && !open && <button className="btn btn-client btn-sm" onClick={() => setOpen(true)}>New Chat</button>}
      {complaint.reply && open && <ChatThread complaint={complaint} inputValue={chatText} onInput={setChatText} onSend={send} buttonClass="btn-client" />}
    </div>
  );
}

function ProfileModal({ user, onClose, onSave }) {
  const [form, setForm] = useState({ name: user.name || "", avatar: user.avatar || "", oldPassword: "", newPassword: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const uploadAvatar = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, avatar: reader.result }));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setMsg("");
    if (!form.name.trim()) return setMsg("Name is required.");
    if (form.newPassword && !form.oldPassword) return setMsg("Enter old password first.");
    setBusy(true);
    try {
      await onSave(form);
      onClose();
    } catch (error) {
      setMsg(friendlyError(error) || "Could not update profile.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Member Profile</h2>
        <div className="row gap12 mb16">
          <Avatar name={form.name} avatar={form.avatar} type="client" size="lg" />
          <div style={{ flex: 1 }}>
            <label className="label">Display Picture</label>
            <input className="inp" type="file" accept="image/*" onChange={(e) => uploadAvatar(e.target.files?.[0])} />
          </div>
        </div>
        <div className="form-group"><label className="label">Name</label><input className="inp" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
        <div className="form-row">
          <div className="form-group"><label className="label">Old Password</label><input className="inp" type="password" value={form.oldPassword} onChange={(e) => setForm((f) => ({ ...f, oldPassword: e.target.value }))} /></div>
          <div className="form-group"><label className="label">New Password</label><input className="inp" type="password" value={form.newPassword} onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} /></div>
        </div>
        {msg && <p className="err">{msg}</p>}
        <div className="modal-footer"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-client" onClick={save} disabled={busy}>{busy ? "Saving..." : "Save Profile"}</button></div>
      </div>
    </div>
  );
}

function Info({ label, value, sub }) {
  return <div className="info-block"><div className="info-label">{displayText(label)}</div><div className="info-value">{displayText(value)}</div><div className="muted mt8">{displayText(sub)}</div></div>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [adminView, setAdminView] = useState("overview");
  const [memberView, setMemberView] = useState("all");
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const refresh = async () => {
    setErr("");
    const data = await loadData();
    setClients(data.clients);
    setProjects(data.projects);
    setComplaints(data.complaints);
  };

  useEffect(() => {
    refresh().catch((error) => setErr(friendlyError(error) || "Could not load data.")).finally(() => setLoading(false));
  }, []);

  const signup = async (form) => {
    const created = await createClientAccount(form);
    await refresh();
    return created;
  };

  const saveProject = async (project, isCreate) => {
    const localNext = await upsertProject(project, isCreate);
    if (localNext) setProjects(localNext);
    else await refresh();
  };

  const updateMemberProjectStatus = async (project, status) => {
    const taskStatus = status === "Done" ? "Done" : status === "In Progress" ? "In Progress" : null;
    const updatedProject = {
      ...project,
      status,
      tasks: taskStatus
        ? (project.tasks || []).map((task) => (task.assignedMember === user.name ? { ...task, status: taskStatus } : task))
        : project.tasks || [],
    };
    setProjects((prev) => prev.map((p) => (p.id === project.id ? updatedProject : p)));
    await saveProject(updatedProject, false);
    setMemberView(status);
  };

  const saveMemberProfile = async (form) => {
    const oldName = user.name;
    const updatedUser = await updateMemberAccount(user, form);
    const renamedProjects = projects.map((p) => ({
      ...p,
      members: (p.members || []).map((m) => (m === oldName ? updatedUser.name : m)),
      tasks: (p.tasks || []).map((t) => ({ ...t, assignedMember: t.assignedMember === oldName ? updatedUser.name : t.assignedMember })),
    }));

    setUser(updatedUser);
    setClients((prev) => prev.map((c) => (c.id === updatedUser.id ? { ...c, ...updatedUser } : c)));
    setProjects(renamedProjects);

    const changedProjects = renamedProjects.filter((p, i) => JSON.stringify(p) !== JSON.stringify(projects[i]));
    for (const project of changedProjects) await upsertProject(project, false);
  };

  const removeProject = async (id) => {
    const localNext = await deleteProject(id);
    if (localNext) setProjects(localNext);
    else await refresh();
  };

  const sendComplaint = async (message, projectId) => {
    const created = await createComplaint(user.id, message, projectId);
    if (!hasSupabase) setComplaints((prev) => [created, ...prev]);
    else await refresh();
  };

  const saveComplaintReply = async (id, reply) => {
    const localNext = await updateComplaintReply(id, reply);
    if (localNext) setComplaints(localNext);
    else await refresh();
  };

  const sendComplaintChatMessage = async (id, sender, text) => {
    const localNext = await addComplaintMessage(id, sender, text);
    if (localNext) setComplaints(localNext);
    else await refresh();
  };

  const currentTitle = useMemo(() => {
    if (!user) return "TaskFlow";
    if (user.type !== "admin") return memberView === "all" ? "My Assigned Projects" : memberView === "Done" ? "Completed Projects" : `${memberView} Projects`;
    return adminView === "overview" ? "Overview" : adminView === "projects" ? "Project Management" : "Team Members";
  }, [user, adminView, memberView]);

  if (loading) return <><style>{css}</style><div className="empty">Loading TaskFlow...</div></>;
  if (!user) return <><style>{css}</style><AuthScreen clients={clients} onLogin={setUser} onSignup={signup} />{err && <div className="notice">{err}</div>}</>;

  const isAdmin = user.type === "admin";
  const nav = isAdmin ? adminPortal.nav : memberPortal.nav;

  return (
    <>
      <style>{css}</style>
      <div className="shell">
        <aside className={`sidebar ${isAdmin ? "" : "client"}`}>
          <div className="sb-logo"><div className="brand">Task<span>Flow</span></div><div className="sb-sub">{isAdmin ? "Manager Portal" : "Member Portal"}</div></div>
          {nav.map((n) => <button key={n.id} className={`sb-item ${(isAdmin ? adminView : memberView) === n.id ? "active" : ""}`} onClick={() => isAdmin ? setAdminView(n.id) : setMemberView(n.id)}>{n.label}</button>)}
          <div className="sb-footer"><div className="sb-user" onClick={() => !isAdmin && setProfileOpen(true)} style={{ cursor: isAdmin ? "default" : "pointer" }}><Avatar name={user.name} avatar={user.avatar} type={isAdmin ? "admin" : "client"} size="sm" /><div style={{ flex: 1 }}><strong>{user.name}</strong><div className="sb-sub">{isAdmin ? "Team Manager" : user.skill || user.role || "Member"}</div></div><button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setUser(null); }}>Sign out</button></div></div>
        </aside>
        <main className="main">
          <header className="topbar"><h1>{currentTitle}</h1><span className={`badge ${isAdmin ? "admin" : "client"}`}>{isAdmin ? "Manager" : user.skill || user.role || "Member"}</span></header>
          <div className="content">
            {!hasSupabase && <div className="notice">Supabase is not configured yet. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env` to use the database.</div>}
            {err && <div className="notice">{err}</div>}
            {isAdmin && adminView === "overview" && <AdminOverview projects={projects} clients={clients} />}
            {isAdmin && adminView === "projects" && <AdminProjects projects={projects} clients={clients} complaints={complaints} onReply={saveComplaintReply} onMessage={sendComplaintChatMessage} onSave={saveProject} onDelete={removeProject} />}
            {isAdmin && adminView === "clients" && <AdminClients clients={clients} projects={projects} />}
            {!isAdmin && <ClientView user={user} projects={projects} complaints={complaints} projectFilter={memberView} onNavigate={setMemberView} onComplaint={sendComplaint} onMessage={sendComplaintChatMessage} onProjectStatus={updateMemberProjectStatus} />}
          </div>
        </main>
      </div>
      {profileOpen && !isAdmin && <ProfileModal user={user} onClose={() => setProfileOpen(false)} onSave={saveMemberProfile} />}
    </>
  );
}
