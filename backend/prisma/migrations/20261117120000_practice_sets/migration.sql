-- AlterTable: practice sets share the generated-exam table; existing rows stay EXAM.
ALTER TABLE `GeneratedExam`
    ADD COLUMN `purpose` VARCHAR(16) NOT NULL DEFAULT 'EXAM',
    ADD COLUMN `result` JSON NULL,
    ADD COLUMN `submittedAt` DATETIME(3) NULL;
