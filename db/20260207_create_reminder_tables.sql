CREATE TABLE CALENDAR_ReminderRules (
    id NUMBER PRIMARY KEY,
    keyword VARCHAR2(200) NOT NULL,
    reminder_days NUMBER NOT NULL,
    ping_roles VARCHAR2(1000),
    arrangements_required NUMBER(1) DEFAULT 0,
    created_by VARCHAR2(32),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE seq_reminder_rules_id START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE TRIGGER trg_reminder_rules_id
BEFORE INSERT ON CALENDAR_ReminderRules
FOR EACH ROW
BEGIN
  SELECT seq_reminder_rules_id.NEXTVAL INTO :new.id FROM dual;
END;
/

CREATE UNIQUE INDEX idx_reminder_rules_keyword
ON CALENDAR_ReminderRules (keyword);

CREATE TABLE CALENDAR_ReminderOccurrences (
    id NUMBER PRIMARY KEY,
    rule_id NUMBER NOT NULL,
    calendar_id VARCHAR2(255) NOT NULL,
    event_id VARCHAR2(255) NOT NULL,
    occurrence_start TIMESTAMP WITH TIME ZONE NOT NULL,
    occurrence_end TIMESTAMP WITH TIME ZONE,
    summary VARCHAR2(1000),
    reminder_at TIMESTAMP WITH TIME ZONE NOT NULL,
    arrangements_required NUMBER(1) DEFAULT 0,
    completed_at TIMESTAMP WITH TIME ZONE,
    last_prompt_at TIMESTAMP WITH TIME ZONE,
    snoozed_until TIMESTAMP WITH TIME ZONE,
    prompt_message_id VARCHAR2(32),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE seq_reminder_occ_id START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE TRIGGER trg_reminder_occ_id
BEFORE INSERT ON CALENDAR_ReminderOccurrences
FOR EACH ROW
BEGIN
  SELECT seq_reminder_occ_id.NEXTVAL INTO :new.id FROM dual;
END;
/

CREATE UNIQUE INDEX idx_reminder_occ_unique
ON CALENDAR_ReminderOccurrences (rule_id, calendar_id, event_id, occurrence_start);

CREATE INDEX idx_reminder_occ_reminder
ON CALENDAR_ReminderOccurrences (reminder_at, completed_at, snoozed_until);
