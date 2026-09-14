/* Assist OpenUI Lang component library: Quasar v1 + Moqui m-* wrappers (Vue 2). */
(function(root) {
    'use strict';

    function asArray(v) {
        if (v == null) return [];
        return Array.isArray(v) ? v : [v];
    }
    function nodeProps(v) {
        if (v && v.type === 'element' && v.props) return v.props;
        return v && typeof v === 'object' ? v : {};
    }
    function fieldMixin(compType) {
        return {
            props: ['props', 'renderNode'],
            inject: {
                openui: { from: 'openui', default: null },
                openuiFormName: { from: 'openuiFormName', default: undefined }
            },
            computed: {
                fieldName: function() { return this.props && this.props.name; },
                fieldLabel: function() {
                    var p = this.props || {};
                    return p.label || p.name || '';
                },
                fieldValue: function() {
                    var ctx = this.openui, name = this.fieldName, p = this.props || {};
                    if (ctx && ctx.storeTick != null) { /* depend on store */ }
                    if (ctx && name) {
                        var fromStore = ctx.getState('$' + name);
                        if (fromStore != null && fromStore !== '') return fromStore;
                        var fromField = ctx.getFieldValue(this.openuiFormName, name);
                        if (fromField != null && fromField !== '') return fromField;
                    }
                    return p.value != null ? p.value : '';
                }
            },
            methods: {
                onFieldInput: function(v) {
                    var ctx = this.openui, name = this.fieldName;
                    if (!ctx || !name) return;
                    ctx.setState('$' + name, v);
                    ctx.setFieldValue(this.openuiFormName, compType, name, v, true);
                }
            }
        };
    }

    var Input = {
        mixins: [fieldMixin('Input')],
        template: '<m-text-line dense outlined :label="fieldLabel" :value="fieldValue" :name="fieldName" :placeholder="(props&&props.placeholder)||undefined" @input="onFieldInput"></m-text-line>'
    };
    var TextArea = {
        mixins: [fieldMixin('TextArea')],
        template: '<q-input dense outlined autogrow type="textarea" stack-label :label="fieldLabel" :value="fieldValue" :name="fieldName" @input="onFieldInput"></q-input>'
    };
    var CheckBox = {
        mixins: [fieldMixin('CheckBox')],
        template: '<q-checkbox :label="fieldLabel || (props&&props.label)" :value="!!fieldValue" @input="onFieldInput"></q-checkbox>'
    };
    var DateTime = {
        mixins: [fieldMixin('DateTime')],
        computed: {
            dateType: function() {
                var t = (this.props && this.props.type) || 'date-time';
                if (t === 'date' || t === 'time' || t === 'date-time') return t;
                return 'date-time';
            }
        },
        template: '<m-date-time :name="fieldName || \'dt\'" :label="fieldLabel" :type="dateType" :value="fieldValue" @input="onFieldInput"></m-date-time>'
    };
    var Lookup = {
        mixins: [fieldMixin('Lookup')],
        computed: {
            lookupFields: function() {
                var ctx = this.openui;
                if (ctx && ctx.storeTick != null) { /* depend */ }
                return (ctx && ctx.storeSnapshot) || {};
            },
            dependsOnObj: function() {
                var d = this.props && this.props.dependsOn;
                if (d == null || d === '') return undefined;
                if (typeof d === 'object' && !Array.isArray(d)) return d;
                if (typeof d === 'string') {
                    var o = {};
                    o[d] = d;
                    return o;
                }
                return undefined;
            }
        },
        template: '<m-drop-down dense outlined :label="fieldLabel" :value="fieldValue" :name="fieldName" :options-url="props&&props.optionsUrl" :value-field="(props&&props.valueField)||\'value\'" :label-field="(props&&props.labelField)||\'label\'" :server-search="true" :depends-on="dependsOnObj" :fields="lookupFields" @input="onFieldInput"></m-drop-down>'
    };
    var Select = {
        mixins: [fieldMixin('Select')],
        computed: {
            selectOptions: function() {
                var items = asArray(this.props && this.props.items);
                var rn = this.renderNode;
                return items.map(function(it) {
                    var p = nodeProps(it);
                    return { value: p.value, label: p.label || p.value };
                });
            }
        },
        template: '<q-select dense outlined emit-value map-options stack-label :label="fieldLabel" :value="fieldValue" :options="selectOptions" option-value="value" option-label="label" @input="onFieldInput"></q-select>'
    };

    var comps = {
        Stack: {
            props: ['props', 'renderNode'],
            render: function(h) {
                var p = this.props || {};
                var dir = p.direction === 'row' ? 'row' : 'column';
                var gap = p.gap === 's' ? 'q-gutter-sm' : (p.gap === 'l' ? 'q-gutter-lg' : 'q-gutter-md');
                return h('div', { class: dir + ' ' + gap }, this.renderNode(p.children));
            }
        },
        Card: {
            props: ['props', 'renderNode'],
            render: function(h) {
                var p = this.props || {};
                return h('q-card', { class: 'q-mb-md' }, [
                    h('q-card-section', this.renderNode(p.children))
                ]);
            }
        },
        CardHeader: {
            props: ['props', 'renderNode'],
            template: '<div class="q-mb-sm"><div class="text-h6">{{props && props.title}}</div><div v-if="props && props.subtitle" class="text-body2 text-grey-7">{{props.subtitle}}</div></div>'
        },
        TextContent: {
            props: ['props', 'renderNode'],
            template: '<div class="text-body1" style="white-space:pre-wrap">{{props && props.text}}</div>'
        },
        Callout: {
            props: ['props', 'renderNode'],
            computed: {
                bannerClass: function() {
                    var t = (this.props && this.props.type) || 'info';
                    if (t === 'warning' || t === 'negative' || t === 'positive' || t === 'info') return 'bg-' + t + ' text-white';
                    return 'bg-info text-white';
                }
            },
            template: '<q-banner dense class="q-mb-sm" :class="bannerClass">{{props && props.text}}</q-banner>'
        },
        Form: {
            props: ['props', 'renderNode'],
            provide: function() {
                var p = this.props || {};
                return { openuiFormName: p.name };
            },
            render: function(h) {
                var p = this.props || {};
                var kids = asArray(this.renderNode(p.children));
                var submit = p.submit ? this.renderNode(p.submit) : null;
                var body = kids;
                if (submit) body = kids.concat([h('div', { class: 'q-mt-md' }, asArray(submit))]);
                return h('div', { class: 'column q-gutter-sm' }, body);
            }
        },
        FormControl: {
            props: ['props', 'renderNode'],
            render: function(h) {
                var p = this.props || {};
                return h('div', { class: 'q-mb-sm' }, [
                    p.label ? h('div', { class: 'text-caption text-grey-7' }, p.label) : null,
                    this.renderNode(p.control)
                ]);
            }
        },
        Input: Input,
        TextArea: TextArea,
        Select: Select,
        SelectItem: {
            props: ['props', 'renderNode'],
            template: '<span></span>'
        },
        CheckBox: CheckBox,
        DateTime: DateTime,
        Lookup: Lookup,
        Display: {
            props: ['props', 'renderNode'],
            template: '<m-display :label="props && props.label" :display="props && props.text" :value-url="props && props.valueUrl"></m-display>'
        },
        Table: {
            props: ['props', 'renderNode'],
            render: function(h) {
                var colsIn = asArray(this.props && this.props.columns);
                var colDefs = [];
                var i, p, vals, n = 0;
                for (i = 0; i < colsIn.length; i++) {
                    p = nodeProps(colsIn[i]);
                    vals = asArray(p.values);
                    if (vals.length > n) n = vals.length;
                    colDefs.push({
                        name: p.label || ('c' + i),
                        label: p.label || ('c' + i),
                        field: p.label || ('c' + i),
                        align: 'left',
                        values: vals
                    });
                }
                var rows = [];
                for (i = 0; i < n; i++) {
                    var row = { __i: i };
                    colDefs.forEach(function(c) { row[c.field] = c.values[i] != null ? c.values[i] : ''; });
                    rows.push(row);
                }
                var qCols = colDefs.map(function(c) {
                    return { name: c.name, label: c.label, field: c.field, align: 'left' };
                });
                return h('q-table', {
                    props: { dense: true, flat: true, hideBottom: true, pagination: { rowsPerPage: 0 },
                        columns: qCols, data: rows, rowKey: '__i' }
                });
            }
        },
        Col: {
            props: ['props', 'renderNode'],
            template: '<span></span>'
        },
        Button: {
            props: ['props', 'renderNode'],
            inject: { openui: { from: 'openui', default: null } },
            methods: {
                onClick: function() {
                    var ctx = this.openui, p = this.props || {};
                    if (!ctx || !ctx.triggerAction) return;
                    ctx.triggerAction(p.label || 'Submit', undefined, p.action);
                }
            },
            template: '<q-btn unelevated color="primary" no-caps :label="(props&&props.label)||\'Submit\'" :disable="openui && openui.isStreaming" @click="onClick"></q-btn>'
        },
        Buttons: {
            props: ['props', 'renderNode'],
            render: function(h) {
                return h('div', { class: 'q-gutter-sm' }, this.renderNode(this.props && this.props.children));
            }
        },
        Tabs: {
            props: ['props', 'renderNode'],
            data: function() { return { tab: null }; },
            created: function() {
                var kids = asArray(this.props && this.props.children);
                var first = kids[0] && nodeProps(kids[0]);
                this.tab = (first && first.value) || 't0';
            },
            render: function(h) {
                var self = this;
                var kids = asArray(this.props && this.props.children);
                var tabs = [];
                var panels = [];
                kids.forEach(function(k, i) {
                    var p = nodeProps(k);
                    var name = p.value || ('t' + i);
                    tabs.push(h('q-tab', { props: { name: name, label: p.trigger || name } }));
                    panels.push(h('q-tab-panel', { props: { name: name } }, asArray(self.renderNode(p.content))));
                });
                return h('div', [
                    h('q-tabs', {
                        class: 'text-primary',
                        props: { dense: true },
                        model: { value: self.tab, callback: function(v) { self.tab = v; } }
                    }, tabs),
                    h('q-tab-panels', {
                        props: { animated: true },
                        model: { value: self.tab, callback: function(v) { self.tab = v; } }
                    }, panels)
                ]);
            }
        },
        TabItem: {
            props: ['props', 'renderNode'],
            template: '<span></span>'
        }
    };

    var library = { root: 'Stack', components: {} };
    Object.keys(comps).forEach(function(name) {
        library.components[name] = { name: name, component: comps[name], props: {} };
    });

    function loadSpec(cb) {
        if (root.AssistOpenUiSpec) { cb(null, root.AssistOpenUiSpec); return; }
        var rootPath = (root.moqui && root.moqui.webrootVue && root.moqui.webrootVue.appRootPath) || '';
        var url = rootPath + '/js/assist/AssistOpenUiLibrary.spec.json';
        fetch(url, { credentials: 'same-origin' }).then(function(r) {
            if (!r.ok) throw new Error('Failed to load OpenUI library spec');
            return r.json();
        }).then(function(j) {
            root.AssistOpenUiSpec = j;
            cb(null, j);
        }).catch(function(err) { cb(err); });
    }

    root.AssistOpenUiLibrary = library;
    root.loadAssistOpenUiSpec = loadSpec;
})(typeof window !== 'undefined' ? window : this);
