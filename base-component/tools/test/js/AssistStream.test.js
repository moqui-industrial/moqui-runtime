'use strict';
// node --test base-component/tools/test/js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const S = require(path.join(__dirname, '../../../webroot/screen/webroot/js/assist/AssistStream.js'));

function parseAll(chunks) {
    const p = new S.SseParser();
    const events = [];
    chunks.forEach(c => events.push(...p.push(c)));
    const end = p.finish();
    events.push(...end.events);
    return { events, unfinished: end.unfinished };
}
const FRAME = (name, obj, eol) => 'event: ' + name + eol + 'data: ' + JSON.stringify(obj) + eol + eol;

for (const [label, eol] of [['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r']]) {
    test('the same two events with ' + label + ' line ends', () => {
        const text = FRAME('delta', { content: 'a' }, eol) + FRAME('done', { ok: true }, eol);
        const r = parseAll([text]);
        assert.deepEqual(r.events.map(e => e.event), ['delta', 'done']);
        assert.deepEqual(JSON.parse(r.events[0].data), { content: 'a' });
        assert.equal(r.unfinished, false);
    });
    test('the same events with ' + label + ' read one character at a time', () => {
        const text = FRAME('delta', { content: 'é☕' }, eol) + FRAME('done', {}, eol);
        const r = parseAll(text.split(''));
        assert.deepEqual(r.events.map(e => e.event), ['delta', 'done']);
        assert.equal(JSON.parse(r.events[0].data).content, 'é☕');
    });
}

test('a CRLF split between two reads is one line end, not two', () => {
    const r = parseAll(['event: delta\r', '\ndata: {"a":1}\r', '\n\r', '\n']);
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].data, '{"a":1}');
});

test('comments, id and retry are framing; several data lines are joined by a line feed', () => {
    const r = parseAll([': keep-alive\n', 'id: 7\nretry: 1000\nevent: x\ndata: {"a":\ndata: 1}\n\n']);
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].event, 'x');
    assert.deepEqual(JSON.parse(r.events[0].data), { a: 1 });
});

test('a byte order mark at the start is not part of the first field', () => {
    const r = parseAll(['﻿event: x\ndata: 1\n\n']);
    assert.equal(r.events[0].event, 'x');
});

test('an event with no data is not an event, an event without a name is a message', () => {
    const r = parseAll(['event: x\n\n', 'data: 5\n\n']);
    assert.deepEqual(r.events.map(e => e.event), ['message']);
});

test('a stream that ends inside an event says so, and a last line without its line end still counts as a line', () => {
    const cut = parseAll(['event: done\ndata: {"a"']);
    assert.equal(cut.unfinished, true);
    assert.equal(cut.events.length, 0);
    const closed = parseAll(['event: done\ndata: 1\n']);
    assert.equal(closed.unfinished, true); // the blank line that ends the event never came
});

test('UTF-8 split between two reads is whole when decoded as a stream', () => {
    const bytes = Buffer.from(FRAME('delta', { content: 'Cafè ☕' }, '\n'), 'utf8');
    const decoder = new TextDecoder('utf-8');
    const p = new S.SseParser();
    const events = [];
    for (const b of bytes) events.push(...p.push(decoder.decode(Uint8Array.of(b), { stream: true })));
    assert.equal(JSON.parse(events[0].data).content, 'Cafè ☕');
});

test('data that is not JSON is reported, not turned into a string', () => {
    const bad = S.parseData({ event: 'delta', data: '{not json' });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /not JSON/);
    assert.equal(S.parseData({ event: 'x', data: '{"a":1}' }).ok, true);
});

let seq;
function ev(type, extra) {
    return Object.assign({ v: 'v1', seq: ++seq, type, conversationId: '10', runId: '20', inference: 1, responseId: 'resp_1',
        itemId: null, outputIndex: null, contentIndex: null, providerSequence: seq - 1, terminal: false, data: {} }, extra || {});
}
function text(inference, responseId, outputIndex, itemId, delta, contentIndex) {
    return ev('response.output_text.delta', { inference, responseId, outputIndex, itemId, contentIndex: contentIndex == null ? 0 : contentIndex, data: { delta } });
}

test('a turn with a tool has two inferences, the answer is the text of the messages, and the turn ends only with done', () => {
    seq = 0;
    const t = new S.TurnTimeline();
    const feed = e => assert.equal(t.accept(e), true);
    feed(ev('response.created', { data: { response: { id: 'resp_1', status: 'in_progress' } } }));
    feed(ev('response.output_item.added', { outputIndex: 0, itemId: 'fc_1', data: { item: { id: 'fc_1', type: 'function_call', name: 'acceptance_sample', call_id: 'c1' } } }));
    feed(ev('response.function_call_arguments.delta', { outputIndex: 0, itemId: 'fc_1', data: { delta: '{"sampleId":' } }));
    feed(ev('response.function_call_arguments.delta', { outputIndex: 0, itemId: 'fc_1', data: { delta: '"S1"}' } }));
    feed(ev('response.function_call_arguments.done', { outputIndex: 0, itemId: 'fc_1', data: { arguments: '{"sampleId":"S1"}' } }));
    feed(ev('response.output_item.done', { outputIndex: 0, itemId: 'fc_1', data: { item: { id: 'fc_1', type: 'function_call', status: 'completed', arguments: '{"sampleId":"S1"}' } } }));
    feed(ev('response.completed', { terminal: true, data: { response: { id: 'resp_1', status: 'completed', usage: { total_tokens: 5 } } } }));
    assert.equal(t.finished, null);
    feed(Object.assign(ev('response.created', { data: { response: { id: 'resp_2', status: 'in_progress' } } }), { inference: 2, responseId: 'resp_2' }));
    feed(ev('response.output_item.added', { inference: 2, responseId: 'resp_2', outputIndex: 0, itemId: 'msg_2', data: { item: { id: 'msg_2', type: 'message', role: 'assistant' } } }));
    feed(text(2, 'resp_2', 0, 'msg_2', 'sum is '));
    feed(text(2, 'resp_2', 0, 'msg_2', '46'));
    feed(ev('response.completed', { inference: 2, responseId: 'resp_2', terminal: true, data: { response: { id: 'resp_2', status: 'completed' } } }));
    assert.equal(t.finished, null, 'a provider response.completed does not end the turn');
    assert.equal(t.applyTerminal('done', { finishReason: 'stop' }), true);
    assert.equal(t.finished, 'done');
    assert.equal(t.text(), 'sum is 46');
    assert.equal(t.inferences.length, 2);
    assert.equal(t.inferences[0].items[0].arguments, '{"sampleId":"S1"}');
    assert.equal(t.inferences[0].usage.total_tokens, 5);
    assert.equal(t.problem, null);
    assert.equal(t.summary().inferences, 2);
});

test('the numbering of the gateway is checked: a gap, a repeat and an event after the end are problems', () => {
    seq = 0;
    let t = new S.TurnTimeline();
    assert.equal(t.accept(ev('response.created')), true);
    seq += 1; // one event lost
    assert.equal(t.accept(ev('response.in_progress')), false);
    assert.match(t.problem, /not in sequence/);

    seq = 0; t = new S.TurnTimeline();
    const first = ev('response.created');
    t.accept(first);
    assert.equal(t.accept(Object.assign({}, first)), false);

    seq = 0; t = new S.TurnTimeline();
    t.accept(ev('response.created'));
    t.applyTerminal('done', {});
    assert.equal(t.accept(ev('response.in_progress')), false);
    assert.match(t.problem, /after the end/);
});

test('an event of another format is refused, not guessed at', () => {
    const t = new S.TurnTimeline();
    assert.equal(t.accept({ v: 'v9', seq: 1, type: 'response.created' }), false);
    assert.match(t.problem, /unknown format/);
});

test('a refusal is kept as a refusal part and read as text, a failed inference keeps its error', () => {
    seq = 0;
    const t = new S.TurnTimeline();
    t.accept(ev('response.created'));
    t.accept(ev('response.output_item.added', { outputIndex: 0, itemId: 'm', data: { item: { id: 'm', type: 'message', role: 'assistant' } } }));
    t.accept(ev('response.refusal.delta', { outputIndex: 0, itemId: 'm', contentIndex: 0, data: { delta: 'No' } }));
    t.accept(ev('response.refusal.done', { outputIndex: 0, itemId: 'm', contentIndex: 0, data: { refusal: 'No, sorry' } }));
    assert.equal(t.inferences[0].items[0].parts[0].kind, 'refusal');
    assert.equal(t.text(), 'No, sorry');
    t.accept(ev('response.failed', { terminal: true, data: { response: { status: 'failed', error: { code: 'x', message: 'boom' } } } }));
    assert.equal(t.inferences[0].status, 'failed');
    assert.equal(t.inferences[0].error.message, 'boom');
});

test('a gateway error ends the turn and is the problem; done after it is refused', () => {
    seq = 0;
    const t = new S.TurnTimeline();
    t.accept(ev('response.created'));
    assert.equal(t.applyTerminal('error', { message: 'upstream stream is inconsistent' }), true);
    assert.equal(t.problem, 'upstream stream is inconsistent');
    assert.equal(t.applyTerminal('done', {}), false);
});

test('attachments are checked by type, size, count and emptiness before anything is read', () => {
    assert.equal(S.checkAttachment({ type: 'image/png', size: 100 }, 1000, 0), null);
    assert.match(S.checkAttachment({ type: 'image/svg+xml', size: 100 }, 1000, 0), /not accepted/);
    assert.match(S.checkAttachment({ type: 'image/png', size: 5000 }, 1000, 0), /larger than/);
    assert.match(S.checkAttachment({ type: 'image/png', size: 100 }, 1000, 8), /At most 8/);
    assert.match(S.checkAttachment({ type: 'text/plain', size: 0 }, 1000, 0), /empty/);
    assert.equal(S.attachmentKind('image/jpeg'), 'image');
    assert.equal(S.attachmentKind('application/pdf'), 'file');
});

test('the view is a plain copy with sizes and states, never the payloads of a call', () => {
    seq = 0;
    const t = new S.TurnTimeline();
    t.accept(ev('response.created'));
    t.accept(ev('response.output_item.added', { outputIndex: 0, itemId: 'm', data: { item: { id: 'm', type: 'message', role: 'assistant' } } }));
    t.accept(text(1, 'resp_1', 0, 'm', 'hello'));
    t.accept(ev('response.output_text.done', { outputIndex: 0, itemId: 'm', contentIndex: 0, data: { text: 'hello' } }));
    const v = t.view();
    assert.equal(v.inferences[0].items[0].parts[0].chars, 5);
    assert.equal(v.inferences[0].items[0].parts[0].done, true);
    assert.equal(JSON.stringify(v).includes('hello'), false);
});
