-- AlterTable: the past exams a generated exam was written from (NULL for older rows, which keep styleId)
ALTER TABLE `GeneratedExam` ADD COLUMN `styleIds` JSON NULL;
