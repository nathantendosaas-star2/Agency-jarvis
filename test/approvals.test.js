const test = require("node:test");
const assert = require("node:assert");
const { createApprovalRequest, updateApprovalDecision, verifyApprovalGranted } = require("../src/services/approvalService");
const { setSupabaseClient } = require("../src/config/supabase");

test("Approval System Backend Enforcement", async (t) => {
  t.after(() => {
    setSupabaseClient(null);
  });

  await t.test("creates approval requests with pending status", async () => {
    const appr = await createApprovalRequest({
      action_type: "send_email",
      entity_type: "outreach",
      entity_id: "test-id-123",
      title: "Send outreach email to client"
    });

    assert.strictEqual(appr.status, "pending");
    assert.strictEqual(appr.action_type, "send_email");
  });

  await t.test("rejects invalid approval decisions", async () => {
    await assert.rejects(
      async () => {
        await updateApprovalDecision("appr-1", "invalid_choice");
      },
      /Decision must be either 'approved' or 'rejected'/
    );
  });

  await t.test("correctly checks approval status against mock supabase", async () => {
    setSupabaseClient({
      from(table) {
        if (table === "approvals") {
          return {
            select(_fields) {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        eq() {
                          return {
                            order() {
                              return {
                                limit() {
                                  return {
                                    maybeSingle: async () => ({
                                      data: { id: "appr-1", status: "approved" },
                                      error: null
                                    })
                                  };
                                }
                              };
                            }
                          };
                        }
                      };
                    }
                  };
                }
              };
            }
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      }
    });

    const isGranted = await verifyApprovalGranted("outreach", "entity-1", "send_email");
    assert.strictEqual(isGranted, true);
  });
});
