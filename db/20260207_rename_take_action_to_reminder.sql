ALTER TABLE CALENDAR_TakeActionRules RENAME TO CALENDAR_ReminderRules;
ALTER TABLE CALENDAR_TakeActionOccurrences RENAME TO CALENDAR_ReminderOccurrences;

RENAME seq_take_action_rules_id TO seq_reminder_rules_id;
RENAME seq_take_action_occ_id TO seq_reminder_occ_id;

ALTER INDEX idx_take_action_rules_keyword RENAME TO idx_reminder_rules_keyword;
ALTER INDEX idx_take_action_occ_unique RENAME TO idx_reminder_occ_unique;
ALTER INDEX idx_take_action_occ_reminder RENAME TO idx_reminder_occ_reminder;

ALTER TRIGGER trg_take_action_rules_id RENAME TO trg_reminder_rules_id;
ALTER TRIGGER trg_take_action_occ_id RENAME TO trg_reminder_occ_id;

CREATE OR REPLACE TRIGGER trg_reminder_rules_id
BEFORE INSERT ON CALENDAR_ReminderRules
FOR EACH ROW
BEGIN
  SELECT seq_reminder_rules_id.NEXTVAL INTO :new.id FROM dual;
END;
/

CREATE OR REPLACE TRIGGER trg_reminder_occ_id
BEFORE INSERT ON CALENDAR_ReminderOccurrences
FOR EACH ROW
BEGIN
  SELECT seq_reminder_occ_id.NEXTVAL INTO :new.id FROM dual;
END;
/
