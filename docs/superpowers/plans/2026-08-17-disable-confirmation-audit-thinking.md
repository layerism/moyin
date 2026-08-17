# Disable Confirmation Audit Thinking Implementation Plan

> **For agentic workers:** Implement inline in the current session; do not dispatch a subagent. Project rules prohibit running tests during modification.

**Goal:** Explicitly disable model thinking for confirmation-node image audits.

**Architecture:** Keep the existing OpenAI-compatible Chat Completions request and add the provider-supported `thinking.type=disabled` request field directly to internal script version 1. Preserve all other audit behavior.

**Tech Stack:** Python, Volcengine Ark OpenAI-compatible Chat Completions API.

## Global Constraints

- Modify `v1` directly as explicitly requested by the user.
- Do not change model selection, prompts, response format, temperature, or parsing.
- Do not run tests, builds, or browser automation.
- Restart local services after implementation.

---

### Task 1: Disable model thinking

**Files:**
- Modify: `backend/scripts/confirmation-visual-audit/versions/1/handler.py`

**Interfaces:**
- Consumes: the existing JSON request passed to `/chat/completions`.
- Produces: the same request with `thinking` set to `{"type": "disabled"}`.

- [x] Add the explicit `thinking` field beside the existing generation controls.
- [x] Inspect the focused diff and compile the Python source without creating bytecode caches.
- [x] Restart the local backend and frontend services.
- [x] Attempt the completion checkpoint without staging unrelated working-tree changes.
