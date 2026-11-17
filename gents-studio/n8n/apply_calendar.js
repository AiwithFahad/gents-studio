// NODE: "Apply Calendar Result" (Code, run once for all items)
// Receives the output of whichever Calendar node ran (or the plan itself when no calendar op).
// A failed calendar call HALTS the request: nothing has been written yet, so nothing is half-done.
const plan = JSON.parse(JSON.stringify($('Decide Action').first().json));
const res = $input.first().json || {};
let eventId = (plan.calendar && plan.calendar.eventId) || '';
if (plan.calendarOp !== 'none') {
  const err = res.error ? JSON.stringify(res.error) : '';
  const alreadyGone = plan.calendarOp === 'delete' && /404|410|not found|deleted|resource has been deleted/i.test(err);
  if (err && !alreadyGone) {
    return [{ json: { halt: true, status: 502, body: { success: false, code: 'CALENDAR_FAILED', message: 'We could not update the studio calendar, so nothing was changed. Please try again in a moment.' } } }];
  }
  if (plan.calendarOp === 'create') {
    if (!res.id) return [{ json: { halt: true, status: 502, body: { success: false, code: 'CALENDAR_FAILED', message: 'The calendar did not confirm the event, so the booking was not saved. Please try again.' } } }];
    eventId = res.id;
    plan.createdEventId = res.id;
  }
}
const txt = JSON.stringify(plan.writes).split('__EVENT_ID__').join(eventId);
plan.writes = JSON.parse(txt);
plan.halt = false;
plan.stripeKind = (plan.stripe && plan.stripe.kind) || 'none';
return [{ json: plan }];
