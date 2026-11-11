#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use eframe::egui;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const BG: egui::Color32 = egui::Color32::from_rgb(5, 7, 14);
const PANEL: egui::Color32 = egui::Color32::from_rgb(9, 14, 26);
const CARD: egui::Color32 = egui::Color32::from_rgb(15, 22, 40);
const LINE: egui::Color32 = egui::Color32::from_rgb(35, 46, 70);
const TEXT: egui::Color32 = egui::Color32::from_rgb(226, 232, 240);
const MUTED: egui::Color32 = egui::Color32::from_rgb(148, 163, 184);
const ACCENT: egui::Color32 = egui::Color32::from_rgb(167, 139, 250);
const CYAN: egui::Color32 = egui::Color32::from_rgb(34, 211, 238);
const GREEN: egui::Color32 = egui::Color32::from_rgb(52, 211, 153);
const AMBER: egui::Color32 = egui::Color32::from_rgb(251, 191, 36);
const RED: egui::Color32 = egui::Color32::from_rgb(248, 113, 113);

const PROVIDERS: [(&str, &str); 7] = [
    ("nightrouter", "NightRouter"),
    ("exosai", "ExosAI"),
    ("mistral", "Mistral"),
    ("inception", "Inception"),
    ("furry", "Furry"),
    ("bazaarlink", "BazaarLink"),
    ("nagaai", "NagaAI"),
];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tab {
    Dashboard,
    Users,
    ProviderKeys,
    Models,
    Payments,
    Settings,
}

impl Tab {
    fn title(self) -> &'static str {
        match self {
            Tab::Dashboard => "Dashboard",
            Tab::Users => "Users & plans",
            Tab::ProviderKeys => "Provider keys",
            Tab::Models => "Models",
            Tab::Payments => "Payments",
            Tab::Settings => "Settings",
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct Config {
    project_root: String,
    backend_url: String,
    admin_email: String,
    admin_password: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            project_root: std::env::var("NOVA_PROJECT_ROOT").unwrap_or_else(|_| {
                "C:\\Users\\Noway\\.zcode\\workspace\\draft-60239bfb-6fe8-4c79-b711-96d4850b85c5"
                    .to_string()
            }),
            backend_url: "http://127.0.0.1:8080".to_string(),
            admin_email: "admin@novacompute.io".to_string(),
            admin_password: "NovaAdmin!2026".to_string(),
        }
    }
}

#[derive(Clone, Default)]
struct ModelForm {
    id: String,
    name: String,
    provider: String,
    context: String,
    input: f64,
    output: f64,
    category: String,
    upstream: String,
    upstream_id: String,
    tag: String,
    note: String,
    price_unit: String,
    image: bool,
    video: bool,
}

struct App {
    cfg: Config,
    cfg_path: PathBuf,
    tab: Tab,
    api_key: String,
    health: String,
    overview: Value,
    users: Vec<Value>,
    transactions: Vec<Value>,
    models: Vec<Value>,
    custom_models: Vec<Value>,
    provider_keys: BTreeMap<String, Vec<String>>,
    key_input: BTreeMap<String, String>,
    paypal_orders: Value,
    bank_txns: Value,
    status: String,
    search: String,
    model_form: ModelForm,
    confirm_delete: Option<String>,
}

impl App {
    fn new(cc: &eframe::CreationContext<'_>) -> Self {
        setup_style(&cc.egui_ctx);
        let cfg_path = config_path();
        let cfg = load_config(&cfg_path);
        let mut app = Self {
            cfg,
            cfg_path,
            tab: Tab::Dashboard,
            api_key: String::new(),
            health: "checking…".to_string(),
            overview: Value::Null,
            users: Vec::new(),
            transactions: Vec::new(),
            models: Vec::new(),
            custom_models: Vec::new(),
            provider_keys: BTreeMap::new(),
            key_input: BTreeMap::new(),
            paypal_orders: Value::Null,
            bank_txns: Value::Null,
            status: String::new(),
            search: String::new(),
            model_form: ModelForm::default(),
            confirm_delete: None,
        };
        app.refresh();
        app
    }

    fn backend(&self) -> String {
        self.cfg.backend_url.trim_end_matches('/').to_string()
    }

    fn backend_dir(&self) -> PathBuf {
        PathBuf::from(&self.cfg.project_root).join("backend")
    }

    fn api_get(&self, path: &str) -> Result<Value, String> {
        let url = format!("{}{}", self.backend(), path);
        let mut req = ureq::get(&url).timeout(Duration::from_secs(5));
        if !self.api_key.is_empty() {
            req = req.set("Authorization", &format!("Bearer {}", self.api_key));
        }
        match req.call() {
            Ok(resp) => resp.into_json::<Value>().map_err(|e| e.to_string()),
            Err(ureq::Error::Status(code, resp)) => Err(format!(
                "HTTP {}: {}",
                code,
                resp.into_string().unwrap_or_default()
            )),
            Err(e) => Err(e.to_string()),
        }
    }

    fn api_post(&self, path: &str, body: Value) -> Result<Value, String> {
        let url = format!("{}{}", self.backend(), path);
        let mut req = ureq::post(&url).timeout(Duration::from_secs(8));
        if !self.api_key.is_empty() {
            req = req.set("Authorization", &format!("Bearer {}", self.api_key));
        }
        match req.send_json(body) {
            Ok(resp) => resp.into_json::<Value>().map_err(|e| e.to_string()),
            Err(ureq::Error::Status(code, resp)) => Err(format!(
                "HTTP {}: {}",
                code,
                resp.into_string().unwrap_or_default()
            )),
            Err(e) => Err(e.to_string()),
        }
    }

    fn login(&mut self) {
        let url = format!("{}/api/login", self.backend());
        let body = json!({
            "email": self.cfg.admin_email,
            "password": self.cfg.admin_password,
        });
        match ureq::post(&url)
            .timeout(Duration::from_secs(6))
            .send_json(body)
        {
            Ok(resp) => match resp.into_json::<Value>() {
                Ok(v) => {
                    self.api_key = v["api_key"].as_str().unwrap_or("").to_string();
                    if self.api_key.is_empty() {
                        self.status = "Admin login returned no API key.".to_string();
                    }
                }
                Err(e) => self.status = format!("Login parse: {e}"),
            },
            Err(ureq::Error::Status(code, _)) => {
                self.status = format!("Admin login failed (HTTP {code}). Check Settings.");
            }
            Err(e) => self.status = format!("Backend offline: {e}"),
        }
    }

    fn refresh(&mut self) {
        self.status.clear();
        if self.api_key.is_empty() {
            self.login();
        }
        match self.api_get("/api/health") {
            Ok(v) => {
                self.health = format!(
                    "ok · {} models · {} keys",
                    v["models"].as_i64().unwrap_or(0),
                    v["keys_loaded"].as_i64().unwrap_or(0)
                )
            }
            Err(e) => self.health = format!("offline · {e}"),
        }
        if let Ok(v) = self.api_get("/api/admin/overview") {
            self.overview = v;
        }
        if let Ok(v) = self.api_get("/api/admin/users") {
            self.users = v["users"].as_array().cloned().unwrap_or_default();
        }
        if let Ok(v) = self.api_get("/api/admin/transactions") {
            self.transactions = v["transactions"].as_array().cloned().unwrap_or_default();
        }
        if let Ok(v) = self.api_get("/v1/models") {
            self.models = v["data"].as_array().cloned().unwrap_or_default();
        }
        self.load_provider_keys();
        self.load_custom_models();
        self.load_payment_state();
    }

    fn load_provider_keys(&mut self) {
        self.provider_keys.clear();
        for (id, _) in PROVIDERS {
            let path = self.backend_dir().join(format!("{id}_keys.json"));
            self.provider_keys.insert(id.to_string(), read_key_file(&path));
            self.key_input.entry(id.to_string()).or_default();
        }
    }

    fn load_custom_models(&mut self) {
        let path = self.backend_dir().join("custom_models.json");
        self.custom_models = fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default();
    }

    fn load_payment_state(&mut self) {
        let path = self.backend_dir().join("users_db.json");
        if let Ok(s) = fs::read_to_string(path) {
            if let Ok(v) = serde_json::from_str::<Value>(&s) {
                self.paypal_orders = v["paypal_orders"].clone();
                self.bank_txns = v["bank_txns"].clone();
            }
        }
    }

    fn save_provider_keys(&mut self, provider: &str) {
        let keys = self.provider_keys.get(provider).cloned().unwrap_or_default();
        let path = self.backend_dir().join(format!("{provider}_keys.json"));
        match write_json(&path, &json!(keys)) {
            Ok(_) => self.status = format!("Saved {} keys for {provider}.", keys.len()),
            Err(e) => self.status = format!("Save keys failed: {e}"),
        }
    }

    fn admin_update(&mut self, email: &str, payload: Value) {
        let mut body = json!({ "email": email });
        if let Some(obj) = body.as_object_mut() {
            if let Some(p) = payload.as_object() {
                for (k, v) in p {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
        match self.api_post("/api/admin/user", body) {
            Ok(_) => {
                self.status = format!("Updated {email}.");
                self.refresh();
            }
            Err(e) => self.status = format!("Update failed: {e}"),
        }
    }

    fn admin_delete(&mut self, email: &str) {
        match self.api_post("/api/admin/user/delete", json!({ "email": email })) {
            Ok(_) => {
                self.status = format!("Deleted {email}.");
                self.refresh();
            }
            Err(e) => self.status = format!("Delete failed: {e}"),
        }
    }

    fn save_custom_model(&mut self) {
        let f = &self.model_form;
        if f.id.trim().is_empty() || f.name.trim().is_empty() {
            self.status = "Model ID and name are required.".to_string();
            return;
        }
        let entry = json!({
            "id": f.id.trim(),
            "name": f.name.trim(),
            "provider": if f.provider.trim().is_empty() { "Custom" } else { f.provider.trim() },
            "context": if f.context.trim().is_empty() { "—" } else { f.context.trim() },
            "input": f.input,
            "output": f.output,
            "category": if f.category.trim().is_empty() { "chat" } else { f.category.trim() },
            "tag": if f.tag.trim().is_empty() { Value::Null } else { json!(f.tag.trim()) },
            "note": f.note.trim(),
            "price_unit": if f.price_unit.trim().is_empty() { Value::Null } else { json!(f.price_unit.trim()) },
            "image": f.image,
            "video": f.video,
            "upstream": f.upstream.trim(),
            "upstream_id": f.upstream_id.trim(),
        });
        let id = f.id.trim().to_string();
        let mut list = self.custom_models.clone();
        if let Some(pos) = list.iter().position(|m| m["id"].as_str() == Some(&id)) {
            list[pos] = entry;
        } else {
            list.push(entry);
        }
        let path = self.backend_dir().join("custom_models.json");
        match write_json(&path, &json!(list)) {
            Ok(_) => {
                self.status = format!("Saved custom model {id}. Backend hot-reloads it.");
                self.load_custom_models();
                if let Ok(v) = self.api_get("/v1/models") {
                    self.models = v["data"].as_array().cloned().unwrap_or_default();
                }
            }
            Err(e) => self.status = format!("Save model failed: {e}"),
        }
    }

    fn delete_custom_model(&mut self, id: &str) {
        let list: Vec<Value> = self
            .custom_models
            .iter()
            .filter(|m| m["id"].as_str() != Some(id))
            .cloned()
            .collect();
        let path = self.backend_dir().join("custom_models.json");
        if write_json(&path, &json!(list)).is_ok() {
            self.status = format!("Removed custom model {id}.");
            self.load_custom_models();
            self.refresh();
        }
    }

    fn save_config(&mut self) {
        match write_json(&self.cfg_path, &serde_json::to_value(&self.cfg).unwrap_or(Value::Null)) {
            Ok(_) => {
                self.status = "Settings saved.".to_string();
                self.api_key.clear();
                self.refresh();
            }
            Err(e) => self.status = format!("Save settings failed: {e}"),
        }
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        egui::SidePanel::left("sidebar")
            .resizable(false)
            .default_width(232.0)
            .frame(egui::Frame::default().fill(PANEL).inner_margin(14.0))
            .show(ctx, |ui| {
                ui.add_space(4.0);
                ui.label(
                    egui::RichText::new("NovaCompute")
                        .size(20.0)
                        .strong()
                        .color(TEXT),
                );
                ui.label(egui::RichText::new("ADMIN CONSOLE").size(10.0).color(AMBER));
                ui.add_space(18.0);
                for (tab, label) in [
                    (Tab::Dashboard, "Dashboard"),
                    (Tab::Users, "Users & plans"),
                    (Tab::ProviderKeys, "Provider keys"),
                    (Tab::Models, "Models"),
                    (Tab::Payments, "Payments"),
                    (Tab::Settings, "Settings"),
                ] {
                    if ui
                        .selectable_label(self.tab == tab, egui::RichText::new(label).size(14.0))
                        .clicked()
                    {
                        self.tab = tab;
                    }
                }
                ui.add_space(20.0);
                ui.separator();
                ui.add_space(10.0);
                ui.label(egui::RichText::new("ADMIN LOGIN").size(10.0).color(MUTED));
                ui.add_space(4.0);
                ui.label(egui::RichText::new(&self.cfg.admin_email).size(12.0).color(TEXT));
                ui.label(
                    egui::RichText::new(&self.cfg.admin_password)
                        .size(12.0)
                        .monospace()
                        .color(AMBER),
                );
                ui.horizontal(|ui| {
                    if ui.small_button("Copy").clicked() {
                        ctx.copy_text(format!(
                            "{}\n{}",
                            self.cfg.admin_email, self.cfg.admin_password
                        ));
                    }
                    if ui.small_button("Open web").clicked() {
                        open_url("http://127.0.0.1:8123/admin.html");
                    }
                });
                ui.add_space(8.0);
                if ui.button("Sign in again").clicked() {
                    self.api_key.clear();
                    self.login();
                }
                ui.with_layout(egui::Layout::bottom_up(egui::Align::LEFT), |ui| {
                    ui.label(egui::RichText::new("native Rust · local only").size(10.0).color(MUTED));
                });
            });

        egui::TopBottomPanel::top("top")
            .frame(egui::Frame::default().fill(BG).inner_margin(14.0))
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.heading(egui::RichText::new(self.tab.title()).color(TEXT));
                    ui.add_space(10.0);
                    let color = if self.health.starts_with("ok") { GREEN } else { RED };
                    ui.colored_label(color, format!("● {}", self.health));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.button("Refresh").clicked() {
                            self.refresh();
                        }
                    });
                });
            });

        egui::CentralPanel::default()
            .frame(egui::Frame::default().fill(BG).inner_margin(18.0))
            .show(ctx, |ui| {
                if !self.status.is_empty() {
                    ui.colored_label(AMBER, &self.status);
                    ui.add_space(6.0);
                }
                egui::ScrollArea::vertical().show(ui, |ui| match self.tab {
                    Tab::Dashboard => self.ui_dashboard(ui),
                    Tab::Users => self.ui_users(ui),
                    Tab::ProviderKeys => self.ui_provider_keys(ui),
                    Tab::Models => self.ui_models(ui),
                    Tab::Payments => self.ui_payments(ui),
                    Tab::Settings => self.ui_settings(ui),
                });
            });

        if let Some(email) = self.confirm_delete.clone() {
            let mut confirm = false;
            let mut cancel = false;
            egui::Window::new("Delete account")
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .show(ctx, |ui| {
                    ui.label(format!("Delete {email}? This removes the account, its keys and usage."));
                    ui.add_space(8.0);
                    ui.horizontal(|ui| {
                        if ui.button("Delete").clicked() { confirm = true; }
                        if ui.button("Cancel").clicked() { cancel = true; }
                    });
                });
            if confirm {
                self.admin_delete(&email);
                self.confirm_delete = None;
            } else if cancel {
                self.confirm_delete = None;
            }
        }
    }
}

impl App {
    fn ui_dashboard(&mut self, ui: &mut egui::Ui) {
        let users = num(&self.overview, "users");
        let plans = num(&self.overview, "active_plans");
        let revenue = money(num(&self.overview, "revenue"));
        let reqs = num(&self.overview, "requests_today");
        ui.horizontal_wrapped(|ui| {
            stat_card(ui, "USERS", &users.to_string(), "registered accounts", ACCENT);
            stat_card(ui, "ACTIVE PLANS", &plans.to_string(), "monthly quota plans", CYAN);
            stat_card(ui, "REVENUE", &revenue, "top-ups + subscriptions", GREEN);
            stat_card(ui, "REQUESTS TODAY", &reqs.to_string(), "all models", AMBER);
        });
        ui.add_space(14.0);
        ui.horizontal_wrapped(|ui| {
            let keys: usize = self.provider_keys.values().map(Vec::len).sum();
            stat_card(ui, "PROVIDER KEYS", &keys.to_string(), "across 7 upstreams", ACCENT);
            stat_card(
                ui,
                "MODELS",
                &self.models.len().to_string(),
                "public catalogue",
                CYAN,
            );
            stat_card(
                ui,
                "BALANCES",
                &money(num(&self.overview, "total_balance")),
                "customer balances",
                GREEN,
            );
            stat_card(
                ui,
                "TOKENS TODAY",
                &short_num(num(&self.overview, "tokens_today")),
                "input + output",
                AMBER,
            );
        });
        ui.add_space(18.0);
        card(ui, |ui| {
            ui.label(egui::RichText::new("Admin account").size(16.0).strong().color(TEXT));
            ui.label(
                egui::RichText::new("Use this account to sign in to the web admin console.")
                    .size(12.0)
                    .color(MUTED),
            );
            ui.add_space(8.0);
            ui.monospace(egui::RichText::new(&self.cfg.admin_email).color(CYAN));
            ui.monospace(egui::RichText::new(&self.cfg.admin_password).color(AMBER));
            ui.horizontal(|ui| {
                if ui.button("Copy login").clicked() {
                    ui.ctx().copy_text(format!(
                        "{}\n{}",
                        self.cfg.admin_email, self.cfg.admin_password
                    ));
                }
                if ui.button("Open web console").clicked() {
                    open_url("http://127.0.0.1:8123/admin.html");
                }
            });
        });
    }

    fn ui_users(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.label("Search");
            ui.add(
                egui::TextEdit::singleline(&mut self.search)
                    .hint_text("email or name")
                    .desired_width(300.0),
            );
            if ui.button("Refresh").clicked() {
                self.refresh();
            }
        });
        ui.add_space(10.0);
        let search = self.search.to_lowercase();
        let mut actions: Vec<(String, Value)> = Vec::new();
        let mut delete_request: Option<String> = None;
        card(ui, |ui| {
            egui::ScrollArea::horizontal().show(ui, |ui| {
                egui::Grid::new("users-grid")
                    .striped(true)
                    .num_columns(9)
                    .min_col_width(58.0)
                    .spacing([18.0, 12.0])
                    .show(ui, |ui| {
                        for h in ["Account", "Plan", "Balance", "Admin", "Banned", "Requests", "Tokens", "Last used", ""] {
                            ui.label(egui::RichText::new(h).size(10.0).color(MUTED));
                        }
                        ui.end_row();
                        for u in &self.users {
                            let email = u["email"].as_str().unwrap_or("").to_string();
                            let name = u["name"].as_str().unwrap_or("");
                            if !search.is_empty()
                                && !email.to_lowercase().contains(&search)
                                && !name.to_lowercase().contains(&search)
                            {
                                continue;
                            }
                            ui.vertical(|ui| {
                                ui.set_min_width(200.0);
                                ui.label(egui::RichText::new(if name.is_empty() { &email } else { name }).color(TEXT));
                                ui.label(egui::RichText::new(&email).size(10.0).monospace().color(MUTED));
                            });
                            let mut plan = u["plan"].as_str().unwrap_or("free").to_string();
                            let before = plan.clone();
                            ui.vertical(|ui| {
                                ui.set_min_width(120.0);
                                egui::ComboBox::from_id_salt(format!("plan-{email}"))
                                    .width(120.0)
                                    .selected_text(plan_label(&plan))
                                    .show_ui(ui, |ui| {
                                        for p in ["free", "starter", "pro", "ultra"] {
                                            ui.selectable_value(&mut plan, p.to_string(), plan_label(p));
                                        }
                                    });
                            });
                            if plan != before {
                                actions.push((email.clone(), json!({ "plan": plan })));
                            }
                            ui.vertical(|ui| { ui.set_min_width(85.0); ui.label(money(u["balance"].as_f64().unwrap_or(0.0))); });
                            let mut admin = u["is_admin"].as_bool().unwrap_or(false);
                            if ui.checkbox(&mut admin, "").changed() {
                                actions.push((email.clone(), json!({ "is_admin": admin })));
                            }
                            let mut banned = u["banned"].as_bool().unwrap_or(false);
                            if ui.checkbox(&mut banned, "").changed() {
                                actions.push((email.clone(), json!({ "banned": banned })));
                            }
                            let mut delta = 0.0;
                            ui.horizontal(|ui| {
                                ui.add(
                                    egui::DragValue::new(&mut delta)
                                        .speed(1.0)
                                        .prefix("±$")
                                        .range(-1000.0..=1000.0),
                                );
                                if ui.small_button("Apply").clicked() && delta != 0.0 {
                                    actions.push((email.clone(), json!({ "balance_delta": delta })));
                                }
                            });
                            ui.label(num(u, "requests").to_string());
                            ui.label(short_num(num(u, "tokens")));
                            ui.label(time_ago(u["last_used"].as_i64().unwrap_or(0)));
                            if ui.small_button("Delete").clicked() {
                                delete_request = Some(email.clone());
                            }
                            ui.end_row();
                        }
                    });
            });
        });
        if let Some(email) = delete_request {
            self.confirm_delete = Some(email);
        }
        for (email, payload) in actions {
            self.admin_update(&email, payload);
        }
    }

    fn ui_provider_keys(&mut self, ui: &mut egui::Ui) {
        let mut changed: Option<String> = None;
        card(ui, |ui| {
            ui.label(egui::RichText::new("Upstream key pools").size(16.0).strong().color(TEXT));
            ui.label(
                egui::RichText::new("Read by the backend on every request. Add or delete without restarting.")
                    .size(11.0)
                    .color(MUTED),
            );
            ui.add_space(6.0);
            for (id, title) in PROVIDERS {
            let keys = self.provider_keys.get(id).cloned().unwrap_or_default();
            egui::CollapsingHeader::new(format!("{title}  ·  {} keys", keys.len()))
                .id_salt(format!("keys-{id}"))
                .show(ui, |ui| {
                    for (idx, key) in keys.iter().enumerate() {
                        ui.horizontal(|ui| {
                            ui.monospace(mask_key(key));
                            if ui.small_button("Delete").clicked() {
                                if let Some(list) = self.provider_keys.get_mut(id) {
                                    list.remove(idx);
                                    changed = Some(id.to_string());
                                }
                            }
                        });
                    }
                    ui.horizontal(|ui| {
                        let input = self.key_input.entry(id.to_string()).or_default();
                        ui.add(
                            egui::TextEdit::singleline(input)
                                .hint_text("new API key")
                                .desired_width(380.0),
                        );
                        if ui.button("Add").clicked() {
                            let value = self.key_input.get(id).cloned().unwrap_or_default();
                            let value = value.trim().to_string();
                            if !value.is_empty() {
                                if let Some(list) = self.provider_keys.get_mut(id) {
                                    if !list.contains(&value) {
                                        list.push(value);
                                        changed = Some(id.to_string());
                                    }
                                }
                                self.key_input.insert(id.to_string(), String::new());
                            }
                        }
                    });
                });
                ui.add_space(2.0);
            }
        });
        if let Some(id) = changed {
            self.save_provider_keys(&id);
        }
    }

    fn ui_models(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.label(
                egui::RichText::new(format!("{} models in the live catalogue", self.models.len()))
                    .size(12.0)
                    .color(MUTED),
            );
            if ui.button("Refresh").clicked() {
                self.refresh();
            }
        });
        ui.add_space(2.0);
        ui.label(egui::RichText::new("Click Edit on a model to load it into the custom form below. Saving creates a hot-reload override, including new prices.").size(11.0).color(MUTED));
        ui.add_space(6.0);
        let mut edit_request: Option<Value> = None;
        card(ui, |ui| {
            egui::ScrollArea::horizontal().show(ui, |ui| {
                egui::Grid::new("models-grid")
                    .striped(true)
                    .num_columns(8)
                    .min_col_width(70.0)
                    .spacing([16.0, 10.0])
                    .show(ui, |ui| {
                        for h in ["Model", "API ID", "Provider", "Context", "Input/1M", "Output/1M", "Type", ""] {
                            ui.label(egui::RichText::new(h).size(10.0).color(MUTED));
                        }
                        ui.end_row();
                        for m in &self.models {
                            ui.label(m["name"].as_str().unwrap_or(""));
                            ui.monospace(m["id"].as_str().unwrap_or(""));
                            ui.label(m["owned_by"].as_str().unwrap_or(""));
                            ui.label(m["context"].as_str().unwrap_or("—"));
                            ui.monospace(money(m["pricing"]["input_per_1m"].as_f64().unwrap_or(0.0)));
                            ui.monospace(money(m["pricing"]["output_per_1m"].as_f64().unwrap_or(0.0)));
                            ui.label(m["category"].as_str().unwrap_or("chat"));
                            if ui.small_button("Edit").clicked() {
                                edit_request = Some(m.clone());
                            }
                            ui.end_row();
                        }
                    });
            });
        });
        if let Some(m) = edit_request {
            let id = m["id"].as_str().unwrap_or("").to_string();
            let custom = self.custom_models.iter().find(|c| c["id"].as_str() == Some(&id));
            self.model_form = ModelForm {
                id: id.clone(),
                name: m["name"].as_str().unwrap_or("").to_string(),
                provider: m["owned_by"].as_str().unwrap_or("").to_string(),
                context: m["context"].as_str().unwrap_or("").to_string(),
                input: m["pricing"]["input_per_1m"].as_f64().unwrap_or(0.0),
                output: m["pricing"]["output_per_1m"].as_f64().unwrap_or(0.0),
                category: m["category"].as_str().unwrap_or("chat").to_string(),
                upstream: custom.and_then(|c| c["upstream"].as_str()).unwrap_or("").to_string(),
                upstream_id: custom.and_then(|c| c["upstream_id"].as_str()).unwrap_or("").to_string(),
                tag: m["tag"].as_str().unwrap_or("").to_string(),
                note: m["note"].as_str().unwrap_or("").to_string(),
                price_unit: m["price_unit"].as_str().unwrap_or("").to_string(),
                image: m["capabilities"]["image"].as_bool().unwrap_or(false),
                video: m["capabilities"]["video"].as_bool().unwrap_or(false),
            };
            self.status = format!("Editing {id}. Change the price below and click Save custom model.");
        }
        ui.add_space(14.0);
        card(ui, |ui| {
            ui.label(egui::RichText::new("Custom model / override").size(16.0).strong().color(TEXT));
            egui::Grid::new("model-form").num_columns(4).show(ui, |ui| {
                ui.label("ID"); ui.add(egui::TextEdit::singleline(&mut self.model_form.id).desired_width(200.0));
                ui.label("Name"); ui.add(egui::TextEdit::singleline(&mut self.model_form.name).desired_width(200.0)); ui.end_row();
                ui.label("Provider"); ui.add(egui::TextEdit::singleline(&mut self.model_form.provider).desired_width(200.0));
                ui.label("Context"); ui.add(egui::TextEdit::singleline(&mut self.model_form.context).desired_width(200.0)); ui.end_row();
                ui.label("Input / 1M"); ui.add(egui::DragValue::new(&mut self.model_form.input).speed(0.001).range(0.0..=1000.0));
                ui.label("Output / 1M"); ui.add(egui::DragValue::new(&mut self.model_form.output).speed(0.001).range(0.0..=1000.0)); ui.end_row();
                ui.label("Category"); ui.add(egui::TextEdit::singleline(&mut self.model_form.category).desired_width(200.0));
                ui.label("Upstream provider"); ui.add(egui::TextEdit::singleline(&mut self.model_form.upstream).hint_text("nightrouter / nagaai…").desired_width(200.0)); ui.end_row();
                ui.label("Upstream model ID"); ui.add(egui::TextEdit::singleline(&mut self.model_form.upstream_id).desired_width(200.0));
                ui.label("Tag"); ui.add(egui::TextEdit::singleline(&mut self.model_form.tag).desired_width(200.0)); ui.end_row();
                ui.label("Note"); ui.add(egui::TextEdit::singleline(&mut self.model_form.note).desired_width(420.0));
                ui.label("Price unit"); ui.add(egui::TextEdit::singleline(&mut self.model_form.price_unit).hint_text("1k_chars for TTS").desired_width(200.0));
                ui.horizontal(|ui| { ui.checkbox(&mut self.model_form.image, "image"); ui.checkbox(&mut self.model_form.video, "video"); }); ui.end_row();
            });
            ui.horizontal(|ui| {
                if ui.button("Save custom model").clicked() { self.save_custom_model(); }
                if ui.button("Clear").clicked() { self.model_form = ModelForm::default(); }
            });
            if !self.custom_models.is_empty() {
                ui.add_space(8.0);
                ui.label(egui::RichText::new("Overrides in custom_models.json").size(12.0).color(MUTED));
                let list = self.custom_models.clone();
                for m in list {
                    let id = m["id"].as_str().unwrap_or("").to_string();
                    ui.horizontal(|ui| {
                        ui.monospace(&id);
                        ui.label(m["name"].as_str().unwrap_or(""));
                        if ui.small_button("Load").clicked() {
                            self.model_form = ModelForm {
                                id: id.clone(),
                                name: m["name"].as_str().unwrap_or("").to_string(),
                                provider: m["provider"].as_str().unwrap_or("").to_string(),
                                context: m["context"].as_str().unwrap_or("").to_string(),
                                input: m["input"].as_f64().unwrap_or(0.0),
                                output: m["output"].as_f64().unwrap_or(0.0),
                                category: m["category"].as_str().unwrap_or("chat").to_string(),
                                upstream: m["upstream"].as_str().unwrap_or("").to_string(),
                                upstream_id: m["upstream_id"].as_str().unwrap_or("").to_string(),
                                tag: m["tag"].as_str().unwrap_or("").to_string(),
                                note: m["note"].as_str().unwrap_or("").to_string(),
                                price_unit: m["price_unit"].as_str().unwrap_or("").to_string(),
                                image: m["image"].as_bool().unwrap_or(false),
                                video: m["video"].as_bool().unwrap_or(false),
                            };
                        }
                        if ui.small_button("Delete").clicked() {
                            self.delete_custom_model(&id);
                        }
                    });
                }
            }
        });
    }

    fn ui_payments(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.label(
                egui::RichText::new(format!(
                    "{} transactions · {} PayPal orders · {} bank events",
                    self.transactions.len(),
                    obj_len(&self.paypal_orders),
                    obj_len(&self.bank_txns)
                ))
                .size(12.0)
                .color(MUTED),
            );
            if ui.button("Refresh").clicked() {
                self.refresh();
            }
        });
        ui.add_space(6.0);
        card(ui, |ui| {
        egui::ScrollArea::horizontal().show(ui, |ui| {
            egui::Grid::new("tx-grid").striped(true).show(ui, |ui| {
                for h in ["Date", "Account", "Description", "Method", "Amount"] {
                    ui.label(egui::RichText::new(h).size(10.0).color(MUTED));
                }
                ui.end_row();
                for t in &self.transactions {
                    ui.label(date_ts(t["ts"].as_i64().unwrap_or(0)));
                    ui.monospace(t["email"].as_str().unwrap_or(""));
                    ui.label(t["description"].as_str().unwrap_or(""));
                    ui.label(t["method"].as_str().unwrap_or(""));
                    let amount = t["amount"].as_f64().unwrap_or(0.0);
                    ui.colored_label(if amount > 0.0 { GREEN } else { TEXT }, money(amount));
                    ui.end_row();
                }
            });
        });
        });
        if self.transactions.is_empty() {
            ui.colored_label(MUTED, "No transactions yet.");
        }
    }

    fn ui_settings(&mut self, ui: &mut egui::Ui) {
        card(ui, |ui| {
            ui.label(egui::RichText::new("Connection").size(16.0).strong().color(TEXT));
            egui::Grid::new("settings-grid").num_columns(2).show(ui, |ui| {
                ui.label("Project root");
                ui.add(egui::TextEdit::singleline(&mut self.cfg.project_root).desired_width(520.0)); ui.end_row();
                ui.label("Backend URL");
                ui.add(egui::TextEdit::singleline(&mut self.cfg.backend_url).desired_width(360.0)); ui.end_row();
                ui.label("Admin email");
                ui.add(egui::TextEdit::singleline(&mut self.cfg.admin_email).desired_width(360.0)); ui.end_row();
                ui.label("Admin password");
                ui.add(egui::TextEdit::singleline(&mut self.cfg.admin_password).password(true).desired_width(360.0)); ui.end_row();
            });
            ui.horizontal(|ui| {
                if ui.button("Save settings").clicked() { self.save_config(); }
                if ui.button("Test backend").clicked() { self.api_key.clear(); self.refresh(); }
                if ui.button("Open project folder").clicked() { open_folder(&self.cfg.project_root); }
                if ui.button("Open web admin").clicked() { open_url("http://127.0.0.1:8123/admin.html"); }
            });
            ui.label(egui::RichText::new(format!("Config file: {}", self.cfg_path.display())).size(10.0).color(MUTED));
        });
        ui.add_space(12.0);
        card(ui, |ui| {
            ui.label(egui::RichText::new("Admin note").size(16.0).strong().color(TEXT));
            ui.label("This native console reads/writes the local backend files directly and signs in to the admin API with the account above. The same credentials open the web console.");
            ui.add_space(6.0);
            ui.monospace(format!("{} / {}", self.cfg.admin_email, self.cfg.admin_password));
            if ui.button("Copy admin login").clicked() {
                ui.ctx().copy_text(format!("{}\n{}", self.cfg.admin_email, self.cfg.admin_password));
            }
        });
    }
}

fn setup_style(ctx: &egui::Context) {
    let mut visuals = egui::Visuals::dark();
    visuals.panel_fill = BG;
    visuals.window_fill = PANEL;
    visuals.extreme_bg_color = CARD;
    visuals.faint_bg_color = CARD;
    visuals.override_text_color = Some(TEXT);
    visuals.widgets.noninteractive.bg_stroke = egui::Stroke::new(1.0, LINE);
    visuals.widgets.inactive.bg_fill = CARD;
    visuals.widgets.hovered.bg_fill = egui::Color32::from_rgb(28, 38, 62);
    visuals.selection.bg_fill = egui::Color32::from_rgb(76, 51, 132);
    ctx.set_visuals(visuals);

    let mut style = (*ctx.style()).clone();
    style.spacing.item_spacing = egui::vec2(10.0, 8.0);
    style.spacing.button_padding = egui::vec2(10.0, 5.0);
    style.visuals.widgets.noninteractive.corner_radius = egui::CornerRadius::same(10);
    style.visuals.widgets.inactive.corner_radius = egui::CornerRadius::same(8);
    style.visuals.widgets.hovered.corner_radius = egui::CornerRadius::same(8);
    style.visuals.widgets.active.corner_radius = egui::CornerRadius::same(8);
    ctx.set_style(style);

    let mut fonts = egui::FontDefinitions::default();
    if let Ok(bytes) = fs::read("C:\\Windows\\Fonts\\segoeui.ttf") {
        fonts
            .font_data
            .insert("segoe".to_owned(), egui::FontData::from_owned(bytes).into());
        fonts
            .families
            .entry(egui::FontFamily::Proportional)
            .or_default()
            .insert(0, "segoe".to_owned());
    }
    ctx.set_fonts(fonts);
}

fn card(ui: &mut egui::Ui, add: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::group(ui.style())
        .fill(CARD)
        .stroke(egui::Stroke::new(1.0, LINE))
        .inner_margin(16.0)
        .show(ui, add);
}

fn stat_card(ui: &mut egui::Ui, label: &str, value: &str, note: &str, color: egui::Color32) {
    egui::Frame::group(ui.style())
        .fill(CARD)
        .stroke(egui::Stroke::new(1.0, LINE))
        .inner_margin(14.0)
        .show(ui, |ui| {
            ui.set_min_width(170.0);
            ui.label(egui::RichText::new(label).size(10.0).color(MUTED));
            ui.label(egui::RichText::new(value).size(25.0).strong().color(color));
            ui.label(egui::RichText::new(note).size(10.0).color(MUTED));
        });
}

fn config_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("console_config.json")
}

fn load_config(path: &Path) -> Config {
    if let Ok(s) = fs::read_to_string(path) {
        if let Ok(cfg) = serde_json::from_str::<Config>(&s) {
            return cfg;
        }
    }
    let cfg = Config::default();
    let _ = write_json(path, &serde_json::to_value(&cfg).unwrap_or(Value::Null));
    cfg
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn read_key_file(path: &Path) -> Vec<String> {
    let Ok(s) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(v) = serde_json::from_str::<Value>(&s) else {
        return Vec::new();
    };
    let Some(arr) = v.as_array() else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| {
            item.as_str()
                .map(str::to_string)
                .or_else(|| item["api_key"].as_str().map(str::to_string))
        })
        .collect()
}

fn mask_key(key: &str) -> String {
    if key.len() <= 12 {
        return "••••".to_string();
    }
    format!("{}…{}", &key[..8], &key[key.len() - 4..])
}

fn num(v: &Value, key: &str) -> f64 {
    v[key].as_f64().or_else(|| v[key].as_i64().map(|i| i as f64)).unwrap_or(0.0)
}

fn money(v: f64) -> String {
    format!("${:.2}", v)
}

fn short_num(v: f64) -> String {
    if v >= 1_000_000.0 {
        format!("{:.1}M", v / 1_000_000.0)
    } else if v >= 1_000.0 {
        format!("{:.1}K", v / 1_000.0)
    } else {
        format!("{}", v as i64)
    }
}

fn plan_label(plan: &str) -> String {
    match plan {
        "starter" => "Starter".to_string(),
        "pro" => "Pro".to_string(),
        "ultra" => "Ultra".to_string(),
        _ => "Pay-as-you-go".to_string(),
    }
}

fn time_ago(ts: i64) -> String {
    if ts <= 0 {
        return "Never".to_string();
    }
    let now = chrono::Utc::now().timestamp();
    let mins = ((now - ts).max(0) / 60) as i64;
    if mins < 1 {
        "Just now".to_string()
    } else if mins < 60 {
        format!("{mins} min ago")
    } else if mins < 1440 {
        format!("{}h ago", mins / 60)
    } else {
        format!("{}d ago", mins / 1440)
    }
}

fn date_ts(ts: i64) -> String {
    if ts <= 0 {
        return "—".to_string();
    }
    chrono::DateTime::from_timestamp(ts, 0)
        .map(|d| d.format("%b %d").to_string())
        .unwrap_or_else(|| "—".to_string())
}

fn obj_len(v: &Value) -> usize {
    v.as_object().map(|o| o.len()).unwrap_or(0)
}

fn open_url(url: &str) {
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn();
}

fn open_folder(path: &str) {
    let _ = std::process::Command::new("explorer").arg(path).spawn();
}

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1280.0, 820.0])
            .with_min_inner_size([980.0, 640.0]),
        ..Default::default()
    };
    eframe::run_native(
        "NovaCompute Admin",
        options,
        Box::new(|cc| Ok(Box::new(App::new(cc)))),
    )
}
