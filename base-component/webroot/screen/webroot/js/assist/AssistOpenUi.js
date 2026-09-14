/* Assist OpenUI Lang renderer (Vue 2.7). Port of @openuidev/vue-lang state/Renderer against lang-core. */
(function(root) {
    'use strict';

    function unwrapFieldValue(v) {
        if (v && typeof v === 'object' && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, 'value'))
            return v.value;
        return v;
    }
    function flattenRender(list) {
        var out = [];
        function walk(v) {
            if (v == null || v === false) return;
            if (Array.isArray(v)) { v.forEach(walk); return; }
            out.push(v);
        }
        walk(list);
        return out;
    }
    function validateActionPath(path) {
        if (root.AssistOpenUiNav && typeof root.AssistOpenUiNav.validatePath === 'function')
            return root.AssistOpenUiNav.validatePath(path);
        if (!path || path.charAt(0) !== '/') return 'path must start with /';
        if (path.indexOf('://') >= 0 || path.indexOf('//') === 0) return 'path must not contain a host';
        if (path.indexOf('..') >= 0) return 'path must not contain ..';
        var lower = String(path).toLowerCase();
        if (lower.indexOf('javascript:') >= 0 || lower.indexOf('data:') >= 0)
            return 'path scheme not allowed';
        return null;
    }
    function isHtmlBody(text, contentType) {
        if (contentType && String(contentType).toLowerCase().indexOf('html') >= 0) return true;
        if (text == null) return false;
        var t = String(text).trim();
        if (!t) return false;
        var head = t.length > 32 ? t.slice(0, 32).toLowerCase() : t.toLowerCase();
        return head.indexOf('<!doctype') === 0 || head.indexOf('<html') === 0
            || head.indexOf('<body') === 0 || head.indexOf('<head') === 0;
    }

    if (typeof Vue === 'undefined') return;

    Vue.component('assist-openui-node', {
        name: 'assist-openui-node',
        props: ['node'],
        inject: ['openui'],
        render: function(h) {
            var node = this.node, ctx = this.openui;
            if (!node) return h('span');
            if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean')
                return h('span', String(node));
            if (node.type !== 'element') return h('span');
            var def = ctx && ctx.library && ctx.library.components[node.typeName];
            if (!def || !def.component) {
                return h('div', { class: 'text-grey-7 text-caption' }, 'Unknown component: ' + node.typeName);
            }
            function renderNode(value) {
                if (value == null) return null;
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
                    return String(value);
                if (Array.isArray(value)) {
                    return flattenRender(value.map(function(item) { return renderNode(item); }));
                }
                if (typeof value === 'object' && value.type === 'element') {
                    return h('assist-openui-node', { key: value.statementId || undefined, props: { node: value } });
                }
                return null;
            }
            return h(def.component, {
                props: { props: node.props || {}, renderNode: renderNode, statementId: node.statementId }
            });
        }
    });

    Vue.component('assist-openui', {
        name: 'assist-openui',
        props: {
            lang: { type: String, default: '' },
            streaming: { type: Boolean, default: false },
            mode: { type: String, default: 'script' },
            csrf: { type: String, default: '' },
            appRoot: { type: String, default: '' },
            initialState: { type: Object, default: function() { return {}; } }
        },
        data: function() {
            return {
                evaluatedRoot: null,
                isQueryLoading: false,
                parseErrors: [],
                storeTick: 0,
                storeSnapshot: {},
                ready: false,
                loadError: null
            };
        },
        provide: function() {
            return { openui: this };
        },
        computed: {
            isStreaming: function() { return !!this.streaming; },
            library: function() { return root.AssistOpenUiLibrary; }
        },
        created: function() {
            this._lastStoreInitKey = '';
            this._lastErrorKey = '';
            var self = this;
            var boot = function() {
                var OpenUI = root.OpenUILang;
                if (!OpenUI) { self.loadError = 'OpenUI lang-core is not loaded'; return; }
                var spec = root.AssistOpenUiSpec;
                if (!spec) { self.loadError = 'OpenUI library spec is not loaded'; return; }
                self._OpenUI = OpenUI;
                self._parser = OpenUI.createStreamingParser(spec, 'Stack');
                self._store = OpenUI.createStore();
                self._qm = OpenUI.createQueryManager(self.makeToolProvider());
                self._qm.activate();
                self._unsubStore = self._store.subscribe(function() {
                    self.storeSnapshot = self._store.getSnapshot();
                    self.storeTick++;
                    self.$emit('state-update', self.storeSnapshot);
                    if (!self.streaming) self.reeval();
                });
                self._unsubQm = self._qm.subscribe(function() {
                    self.isQueryLoading = self._qm.isAnyLoading();
                    if (!self.streaming) self.reeval();
                });
                self.ready = true;
                self.reparse();
            };
            if (root.AssistOpenUiSpec) boot();
            else if (typeof root.loadAssistOpenUiSpec === 'function') {
                root.loadAssistOpenUiSpec(function(err) {
                    if (err) self.loadError = (err && err.message) || String(err);
                    else boot();
                });
            } else boot();
        },
        beforeDestroy: function() {
            if (this._unsubStore) this._unsubStore();
            if (this._unsubQm) this._unsubQm();
            if (this._qm) this._qm.dispose();
            if (this._store) this._store.dispose();
        },
        watch: {
            lang: function() { this.reparse(); },
            streaming: function(v) { if (!v) this.reparse(); }
        },
        methods: {
            getState: function(name) {
                if (!this._store) return undefined;
                return unwrapFieldValue(this._store.get(name));
            },
            setState: function(name, value) {
                if (!this._store) return;
                this._store.set(name, value);
            },
            getFieldValue: function(formName, name) {
                if (!this._store) return undefined;
                if (!formName) return unwrapFieldValue(this._store.get(name));
                var formData = this._store.get(formName);
                if (!formData || typeof formData !== 'object' || Array.isArray(formData)) return undefined;
                return unwrapFieldValue(formData[name]);
            },
            setFieldValue: function(formName, componentType, name, value, shouldSave) {
                if (!this._store) return;
                var wrapped = { value: value, componentType: componentType };
                if (!formName) this._store.set(name, wrapped);
                else {
                    var raw = this._store.get(formName);
                    var formData = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.assign({}, raw) : {};
                    formData[name] = wrapped;
                    this._store.set(formName, formData);
                }
                if (shouldSave !== false) this.$emit('state-update', this._store.getSnapshot());
            },
            valuesMap: function() {
                var snap = this._store ? this._store.getSnapshot() : {};
                var out = {};
                Object.keys(snap).forEach(function(k) {
                    var v = unwrapFieldValue(snap[k]);
                    if (k.charAt(0) === '$') out[k.slice(1)] = v;
                    else if (v && typeof v === 'object' && !Array.isArray(v)) {
                        Object.keys(v).forEach(function(fk) { out[fk] = unwrapFieldValue(v[fk]); });
                    } else out[k] = v;
                });
                return out;
            },
            makeToolProvider: function() {
                var vm = this;
                return {
                    callTool: function(toolName, args) {
                        args = args || {};
                        if (toolName === 'request') return vm.callRequest(args);
                        return Promise.reject(new Error('Unknown OpenUI tool: ' + toolName));
                    }
                };
            },
            callRequest: function(args) {
                var method = String(args.method || 'GET').toUpperCase();
                var path = args.path;
                var pathErr = validateActionPath(path);
                if (pathErr) return Promise.reject(new Error(pathErr));
                if (path.indexOf('/qapps') === 0)
                    return Promise.reject(new Error('Use /apps (not /qapps) for JSON'));
                if (method !== 'GET' && method !== 'HEAD' && this.mode === 'agent')
                    return Promise.reject(new Error('Agent mode does not POST from the canvas'));
                var url = (this.appRoot || '') + path;
                var init = { method: method, credentials: 'same-origin',
                    headers: { 'Accept': 'application/json', 'X-CSRF-Token': this.csrf } };
                if (method === 'GET' || method === 'HEAD') {
                    var q = args.query || args.body || {};
                    var parts = [];
                    Object.keys(q).forEach(function(k) {
                        if (q[k] != null && q[k] !== '') parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(q[k]));
                    });
                    if (parts.length) url += (url.indexOf('?') >= 0 ? '&' : '?') + parts.join('&');
                } else {
                    init.headers['Content-Type'] = 'application/json';
                    init.body = JSON.stringify(args.body || args.query || {});
                }
                return fetch(url, init).then(function(r) {
                    return r.text().then(function(txt) {
                        var ct = r.headers && r.headers.get ? r.headers.get('Content-Type') : null;
                        if (isHtmlBody(txt, ct))
                            throw new Error('HTML screens are not valid tool results. Use /apps (not /qapps).');
                        var parsed = txt;
                        try { parsed = JSON.parse(txt); } catch (e) { /* keep */ }
                        if (r.status >= 400) {
                            var err = new Error('request failed: ' + r.status);
                            err.body = parsed;
                            throw err;
                        }
                        if (Array.isArray(parsed) && path.indexOf('/actions/') >= 0) {
                            var total = r.headers && r.headers.get ? r.headers.get('X-Total-Count') : null;
                            parsed = { rows: parsed,
                                totalCount: total != null && total !== '' ? Number(total) : parsed.length };
                        }
                        return parsed;
                    });
                });
            },
            evaluationContext: function() {
                var store = this._store, qm = this._qm;
                return {
                    getState: function(name) { return unwrapFieldValue(store.get(name)); },
                    resolveRef: function(name) {
                        if (!qm) return null;
                        var mut = qm.getMutationResult(name);
                        if (mut) return mut;
                        return qm.getResult(name);
                    }
                };
            },
            reparse: function() {
                if (!this.ready || !this._parser) return;
                var OpenUI = this._OpenUI;
                var text = this.lang || '';
                var parseResult = null;
                try { parseResult = this._parser.set(text); }
                catch (e) {
                    this.parseErrors = [{ source: 'parser', code: 'parse-exception', message: (e && e.message) || String(e) }];
                    this.evaluatedRoot = null;
                    this.$emit('error', this.parseErrors);
                    return;
                }
                this._parseResult = parseResult;
                var decls = (parseResult && parseResult.stateDeclarations) || {};
                var initial = this.initialState || {};
                var key = JSON.stringify(decls) + '::' + JSON.stringify(initial);
                if (key !== this._lastStoreInitKey) {
                    this._lastStoreInitKey = key;
                    var persisted = {};
                    Object.keys(initial).forEach(function(k) {
                        if (k.charAt(0) === '$') persisted[k] = initial[k];
                        else persisted['$' + k] = initial[k];
                    });
                    this._store.initialize(decls, persisted);
                }
                this.reeval();
            },
            reeval: function() {
                if (!this.ready || !this._parseResult) return;
                var OpenUI = this._OpenUI;
                var res = this._parseResult;
                var errors = (res.meta && res.meta.errors) ? res.meta.errors.slice() : [];
                if (!this.streaming && this._qm) {
                    var evalCtx = this.evaluationContext();
                    var qStmts = res.queryStatements || [];
                    var evaluatedNodes = qStmts.map(function(qn) {
                        return {
                            statementId: qn.statementId,
                            toolName: qn.toolAST ? OpenUI.evaluate(qn.toolAST, evalCtx) : '',
                            args: qn.argsAST ? OpenUI.evaluate(qn.argsAST, evalCtx) : null,
                            defaults: qn.defaultsAST ? OpenUI.evaluate(qn.defaultsAST, evalCtx) : null,
                            refreshInterval: qn.refreshAST ? OpenUI.evaluate(qn.refreshAST, evalCtx) : undefined,
                            deps: qn.deps,
                            complete: qn.complete
                        };
                    });
                    this._qm.evaluateQueries(evaluatedNodes);
                    var mutStmts = res.mutationStatements || [];
                    this._qm.registerMutations(mutStmts.map(function(mn) {
                        return {
                            statementId: mn.statementId,
                            toolName: mn.toolAST ? OpenUI.evaluate(mn.toolAST, evalCtx) : ''
                        };
                    }));
                }
                if (!res.root) {
                    this.evaluatedRoot = null;
                    this.parseErrors = errors;
                    this.$emit('error', errors);
                    return;
                }
                var runtimeErrors = [];
                var evaluated = res.root;
                try {
                    evaluated = OpenUI.evaluateElementProps(res.root, {
                        ctx: this.evaluationContext(),
                        library: this.library,
                        store: this._store,
                        errors: runtimeErrors
                    });
                } catch (e) {
                    runtimeErrors.push({ source: 'runtime', code: 'runtime-error', message: (e && e.message) || String(e) });
                }
                this.evaluatedRoot = evaluated;
                var all = errors.concat(runtimeErrors);
                this.parseErrors = all;
                var ek = JSON.stringify(all);
                if (ek !== this._lastErrorKey) {
                    this._lastErrorKey = ek;
                    this.$emit('error', all);
                }
            },
            navGetLinkPath: function() {
                var r = this.$root;
                if (r && typeof r.getLinkPath === 'function') return r.getLinkPath.bind(r);
                return null;
            },
            triggerAction: function(userMessage, formName, action) {
                var OpenUI = this._OpenUI;
                var self = this;
                var formPayload = this.valuesMap();
                if (action && !action.steps) {
                    this.$emit('action', {
                        type: (action.type) || (OpenUI && OpenUI.BuiltinActionType.ContinueConversation) || 'continue_conversation',
                        params: action.params || {},
                        humanFriendlyMessage: userMessage,
                        formState: formPayload,
                        formName: formName
                    });
                    return;
                }
                var plan = action;
                if (plan && plan.steps) {
                    var i = 0;
                    function next() {
                        if (i >= plan.steps.length) return;
                        var step = plan.steps[i++];
                        if (step.type === 'run') {
                            if (step.refType === 'mutation') {
                                if (self.mode === 'agent') {
                                    self.$emit('action', {
                                        type: 'submit',
                                        params: {},
                                        humanFriendlyMessage: userMessage || 'Submit',
                                        formState: formPayload,
                                        formName: formName
                                    });
                                    return;
                                }
                                var mn = (self._parseResult && self._parseResult.mutationStatements || []).filter(function(m) {
                                    return m.statementId === step.statementId;
                                })[0];
                                var evaluatedArgs = {};
                                if (mn && mn.argsAST) evaluatedArgs = OpenUI.evaluate(mn.argsAST, self.evaluationContext()) || {};
                                self._qm.fireMutation(step.statementId, evaluatedArgs).then(function(ok) {
                                    if (ok) next();
                                });
                            } else {
                                if (self._qm) self._qm.invalidate([step.statementId]);
                                next();
                            }
                        } else if (step.type === 'continue_conversation') {
                            self.$emit('action', {
                                type: 'continue_conversation',
                                params: step.context ? { context: step.context } : {},
                                humanFriendlyMessage: step.message || userMessage,
                                formState: formPayload,
                                formName: formName
                            });
                        } else if (step.type === 'open_url') {
                            self.$emit('action', {
                                type: 'open_url',
                                params: { url: step.url },
                                humanFriendlyMessage: '',
                                formState: formPayload,
                                formName: formName
                            });
                        } else if (step.type === 'set') {
                            if (step.valueAST) {
                                var value = OpenUI.evaluate(step.valueAST, self.evaluationContext());
                                self._store.set(step.target, value);
                            }
                            next();
                        } else if (step.type === 'reset') {
                            var decls = (self._parseResult && self._parseResult.stateDeclarations) || {};
                            (step.targets || []).forEach(function(t) {
                                self._store.set(t, decls[t] != null ? decls[t] : null);
                            });
                            next();
                        } else next();
                    }
                    next();
                    return;
                }
                this.$emit('action', {
                    type: 'continue_conversation',
                    params: {},
                    humanFriendlyMessage: userMessage,
                    formState: formPayload,
                    formName: formName
                });
            }
        },
        template:
            '<div class="assist-openui">' +
                '<div v-if="loadError" class="text-negative q-pa-sm">{{ loadError }}</div>' +
                '<div v-else-if="!ready" class="text-grey-7 q-pa-sm">Loading OpenUI…</div>' +
                '<div v-else-if="isQueryLoading" class="text-caption text-grey-7 q-mb-sm">Loading data…</div>' +
                '<assist-openui-node v-if="evaluatedRoot" :node="evaluatedRoot"></assist-openui-node>' +
                '<div v-else-if="lang && !streaming" class="text-grey-7 q-pa-sm">Nothing to render yet.</div>' +
            '</div>'
    });

    root.AssistOpenUiReady = true;
})(typeof window !== 'undefined' ? window : this);
