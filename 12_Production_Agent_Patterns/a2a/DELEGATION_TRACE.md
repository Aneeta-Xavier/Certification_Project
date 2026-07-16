# A2A run evidence

Captured output from running the `a2a/` mini-project end-to-end against the
Cat Health Specialist server (`server.py`) on `http://127.0.0.1:9999`.
Chat model: `gpt-5.4-mini`.

## 1. Protocol smoke test (`smoke_test.py`, no API key)

```text
PASS  agent card served at /.well-known/agent-card.json
PASS  message/send round-trip
PASS  unknown method returns -32601
PASS  empty message returns -32602
PASS  missing jsonrpc envelope returns -32600

All A2A protocol smoke tests passed.
```

## 2. Agent card discovery (`GET /.well-known/agent-card.json`)

The card is the entire public interface. Note what it does **not** contain:
no model name, no tool list, no framework — those stay private (opacity).

```json
{
    "protocolVersion": "0.3.0",
    "name": "Cat Health Specialist",
    "description": "Educational feline health agent. Answers questions about cat health, care routines, and behavior. Educational information only - not a veterinary service; emergencies belong at a clinic.",
    "url": "http://127.0.0.1:9999",
    "version": "1.0.0",
    "capabilities": { "streaming": false, "pushNotifications": false },
    "defaultInputModes": ["text/plain"],
    "defaultOutputModes": ["text/plain"],
    "skills": [
        {
            "id": "cat-health-qa",
            "name": "Cat health Q&A",
            "description": "Answers educational questions about feline health, preventive care, nutrition, and behavior.",
            "tags": ["cats", "health", "education"],
            "examples": [
                "Do indoor cats need flea prevention?",
                "How often should an adult cat see the vet?"
            ]
        }
    ]
}
```

## 3. Raw JSON-RPC `message/send`

Request:

```json
{ "jsonrpc": "2.0", "id": "1", "method": "message/send",
  "params": { "message": { "kind": "message", "role": "user",
    "parts": [{ "kind": "text", "text": "Do indoor cats need flea prevention?" }],
    "messageId": "m1" } } }
```

Response (live specialist answer):

```json
{ "jsonrpc": "2.0", "id": "1", "result": { "kind": "message", "role": "agent",
  "parts": [{ "kind": "text",
    "text": "Yes—indoor cats can still get fleas, since fleas can come in on clothing, other pets, or through small openings. Regular flea prevention is often recommended, but the best choice depends on your cat's lifestyle and local parasite risk. If you're deciding what's appropriate for your cat, your veterinarian can help choose a safe prevention plan." }],
  "messageId": "a61ea0a4-180a-45f8-b3e7-a368e8970bb7" } }
```

Error path — changing `"method"` to `"tasks/get"` returns a protocol-shaped
error, never a stack trace:

```json
{ "jsonrpc": "2.0", "id": "2",
  "error": { "code": -32601, "message": "Method not found: 'tasks/get'" } }
```

## 4. Delegation trace (`front_desk.py`)

Two questions. The clinic-hours question is answered **locally** (no `[A2A]`
lines). The kitten-health question is **delegated** across the protocol — the
trace shows the front desk phrasing a question, sending it over A2A, and
relaying an answer produced by tools and prompts it cannot see.

```text
Discovered specialist via A2A card: Cat Health Specialist

Q: What are your clinic hours?
A: Whisker Falls Veterinary Clinic is open Monday through Saturday, 9:00 AM to 6:00 PM.
------------------------------------------------------------------------
Q: My kitten keeps sneezing. Should I be worried?
   [front desk -> A2A] consult_cat_health_specialist({'question': 'My kitten keeps sneezing. What are common causes, what mild home care is reasonable, and what warning signs mean the kitten should see a veterinarian urgently?'})
   [A2A -> front desk] Common causes of sneezing in kittens include mild upper respiratory infections, irritants like dust ...
A: According to the Cat Health Specialist, sneezing in kittens can be caused by mild upper
   respiratory infections, irritants like dust or scented products, or sometimes something
   stuck in the nose.
   - Home care: keep the kitten warm and hydrated, provide a humid environment, avoid smoke/
     aerosols/litter dust, gently wipe nasal discharge with a damp cloth.
   - Urgent vet care if: trouble/open-mouth breathing, won't eat or drink, very sleepy or weak,
     thick yellow-green discharge, fever or facial swelling, or sneezing that is frequent,
     worsening, or lasting more than a couple of days.
------------------------------------------------------------------------
```

The `[front desk -> A2A]` / `[A2A -> front desk]` lines are the delegation
crossing the protocol boundary: the front desk consulted a separate agent it
discovered only through the card above, and relayed an answer whose model,
tools, and prompts it never sees.
