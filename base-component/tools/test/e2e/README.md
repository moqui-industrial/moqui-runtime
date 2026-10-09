# Assist acceptance run (U01 to U12)

A real browser (Chrome driven by `playwright-core`), the real Moqui gateway and client, and a provider of the **standard Open
Responses protocol**. The provider is `fake-provider.js` here (deterministic, no network, no key), or any endpoint that
implements the contract when you run with `ACCEPT_LIVE=1`.

## Start the pieces

1. Load the data of the run once: `./gradlew load -Ptypes=llm-acceptance`. It is a second user who is not an administrator
   (`acceptance.second`, password `moqui`) and the permission to see the sample service as a service. Nothing else loads it.
2. The fake provider: `npm install` once in this folder, then `node fake-provider.js --port=9310`.
3. Moqui, with the settings of the provider and of the acceptance tool (a real endpoint instead of the fake one needs only
   the first three):
   ```
   llm_or_standard_url=http://127.0.0.1:9310  llm_or_standard_api_key=<key>  llm_or_standard_model=<model>
   llm_gateway_service_tools=acceptance_sample=org.moqui.impl.LlmAcceptanceServices.get#Sample
   llm_acceptance_nonce=<a random value only you know>
   ./gradlew run
   ```
   `llm_gateway_service_tools` is the list of services the gateway offers to a turn as tools, by exact name (empty by default:
   nothing is offered); the service here is read-only and answers two numbers and your nonce.
4. The run: `ACCEPT_NONCE=<the nonce> npm run acceptance` (more settings are at the top of `run-acceptance.js`:
   `ACCEPT_URL`, `ACCEPT_USER`, `ACCEPT_MOQUI_LOG`, `ACCEPT_LIVE`). It writes `reports/acceptance-report.json`, `.md`,
   screenshots and a video. Exit code 0 means all twelve passed; BLOCKED and FAIL are never counted as passed.

The unit tests of the browser side (SSE framing, the timeline of events, attachment checks) are `npm run test:unit`.

## The picture

`fixture/make-fixture.js` writes `fixture/acceptance-image.png` (white, the text `MOQUI-OR-TEST-731`, three red circles, two
blue squares) from plain pixels, the same bytes every time. What a correct answer says about it is in
`acceptance-manifest.json`, not in any prompt, file name or metadata the screen sends. The fake provider "sees" the picture
only if the bytes it received are these bytes.

## By hand

Open `<your Moqui>/qapps/assist?profile=openresponses-standard` (menu Applications, Assist). The profile is already chosen in the
first box. Press Details to see the timeline. Download the picture from `fixture/acceptance-image.png`.

| ID | What to do | What you must see |
|---|---|---|
| U01 | New. Type: `Write an articulated answer about how streaming responses work, and end it with the marker FINE-U01.` | The text grows before the turn ends, ends with FINE-U01 once; in Details a message item with a text part, a reasoning item, one inference |
| U02 | New. `Remember the code word VIOLETTA-28. Reply briefly.` then `What was the code word?` | The second answer has VIOLETTA-28 |
| U03 | New. Attach the picture (paperclip), type `Read the code in this picture, then count the red circles and the blue squares.` | The picture is in your message; the answer gives MOQUI-OR-TEST-731, 3 red circles, 2 blue squares |
| U04 | Same chat, without attaching again: `Without me attaching it again: how many red circles were in the picture, and what was the code?` | Same facts |
| U05 | Reload the page. | The chat and the picture come back; then `What was the code in the picture?` answers |
| U06 | New. `U06-TOOL: use the sample tool for SMP-4412 and add a and b.` | A call and its result in the chat, two inferences in Details, sum 46 and your nonce in the answer, one end line |
| U07 | New. Switch JSON result on, attach the picture, `Return the code and the counts of this picture as JSON.` | A JSON answer; in Details the badge says JSON valid |
| U08 | New. `U08-LONG write a very long answer about streaming responses.` and press Cancel once text appears | The end line says Cancelled, the text so far stays; the next message works |
| U09 | New. Choose WebSocket in "To the provider". Two messages, then the picture. | Answers continue (Details show the same conversation) |
| U10 | New. A fact, then the picture, then Compact, then `What was the code word, and what was the code in the picture?` | "Compacted: N items kept", and the answer still has both |
| U11 | A second user opens the same conversation (`acceptance.second`); the owner deletes it from Chats | The second user sees nothing; after the delete it is gone |
| U12 | (fake provider only) `U12-INVALID-STREAM please` | An error line, no completed turn |

Against a real model the same prompts apply, but U08 (a long answer on demand), U09 (WebSocket support) and U12 (a broken
stream) need a provider you control; the run marks them BLOCKED instead of passing them.
