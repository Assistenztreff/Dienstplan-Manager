---
name: Task shown MERGED but underlying code change was never applied
description: A project task can display state MERGED (and hard-reject markTaskComplete/markTaskInProgress) while the code change it describes was never actually written to the file it names.
---

Observed case: a task's `getProjectTask` record showed `state: "MERGED"` with an `updatedAt` timestamp from earlier in the day, and both `markTaskComplete` and `markTaskInProgress` hard-failed with "cannot report done from state MERGED" / "TaskMan ReportProgress failed" — even with a `skip_validation_reason`. Despite that, the file/lines the task's plan named still had the *old*, unimplemented behavior (a colored bar instead of the status text the task asked for). The user noticed the missing change from the running app, not from task metadata.

**Why this matters:** the task-tracking "MERGED" state is not proof the described code change exists. The automated per-turn reminder can keep insisting you are "assigned" to a task whose ReportProgress state machine has already permanently closed — do not keep retrying `markTaskComplete`/`markTaskInProgress` against it once it hard-fails on state; that failure mode does not resolve with more attempts or more finished work, it is a one-way state transition.

**How to apply:** if a task is MERGED/closed but its promised behavior isn't visible in the running app, trust the code and the app over the task bookkeeping. Read the actual file/lines the task named, verify by screenshot/behavior, and implement the missing change directly as ordinary (untracked) work — do not block on getting the task-tracking system to accept a new completion call for that ref. Mention the discrepancy to the user rather than silently retrying the completion callback.
