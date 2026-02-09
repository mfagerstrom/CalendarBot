CREATE TABLE CALENDAR_HelpWantedCompletions (
    id NUMBER PRIMARY KEY,
    request_id NUMBER NOT NULL,
    requester_user_id VARCHAR2(32) NOT NULL,
    requester_label VARCHAR2(200),
    role_ids VARCHAR2(1000),
    request_description VARCHAR2(2000) NOT NULL,
    completed_by_user_id VARCHAR2(32) NOT NULL,
    completion_description VARCHAR2(2000) NOT NULL,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE SEQUENCE seq_help_wanted_completions_id START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE TRIGGER trg_help_wanted_completions_id
BEFORE INSERT ON CALENDAR_HelpWantedCompletions
FOR EACH ROW
BEGIN
  SELECT seq_help_wanted_completions_id.NEXTVAL INTO :new.id FROM dual;
END;
/

CREATE INDEX idx_help_wanted_completions_completed_at
ON CALENDAR_HelpWantedCompletions (completed_at);

CREATE INDEX idx_help_wanted_completions_request_id
ON CALENDAR_HelpWantedCompletions (request_id);
