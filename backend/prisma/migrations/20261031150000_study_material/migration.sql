CREATE TABLE `StudyMaterial` (
  `id` VARCHAR(191) NOT NULL,
  `courseId` VARCHAR(191) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(8) NOT NULL,
  `title` VARCHAR(300) NOT NULL,
  `filename` VARCHAR(255) NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `segments` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `StudyMaterial_courseId_ownerId_sha256_key` (`courseId`, `ownerId`, `sha256`),
  INDEX `StudyMaterial_courseId_ownerId_idx` (`courseId`, `ownerId`),
  CONSTRAINT `StudyMaterial_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `Course` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `StudyMaterial_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
