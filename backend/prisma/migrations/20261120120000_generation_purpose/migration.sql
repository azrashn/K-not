-- Quiz sets (2-10 questions on one topic) are kept in GeneratedExam next to generated exams.
ALTER TABLE `GeneratedExam` ADD COLUMN `purpose` VARCHAR(16) NOT NULL DEFAULT 'EXAM';
CREATE INDEX `GeneratedExam_courseId_userId_purpose_idx` ON `GeneratedExam`(`courseId`, `userId`, `purpose`);

-- Questions of a generated exam are kept apart from practice in the quiz history.
ALTER TABLE `LearningQuiz` ADD COLUMN `purpose` VARCHAR(16) NOT NULL DEFAULT 'PRACTICE';
CREATE INDEX `LearningQuiz_userId_courseId_purpose_idx` ON `LearningQuiz`(`userId`, `courseId`, `purpose`);

-- Questions of exams made before this column existed: every quiz_id listed in an exam's items.
UPDATE `LearningQuiz` q
  JOIN `GeneratedExam` e ON e.`userId` = q.`userId` AND e.`courseId` = q.`courseId`
  SET q.`purpose` = 'EXAM'
  WHERE JSON_CONTAINS(JSON_EXTRACT(e.`items`, '$[*].quiz_id'), JSON_QUOTE(q.`id`));
