-- Additive video metadata only. Existing documents/indexes are untouched.
CREATE TABLE `Video` (
  `id` VARCHAR(191) NOT NULL,
  `courseId` VARCHAR(191) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(300) NOT NULL,
  `originalFilename` VARCHAR(255) NOT NULL,
  `contentSha256` CHAR(64) NOT NULL,
  `engineVideoId` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Video_courseId_ownerId_contentSha256_key` (`courseId`, `ownerId`, `contentSha256`),
  INDEX `Video_ownerId_idx` (`ownerId`),
  CONSTRAINT `Video_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `Course` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Video_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
