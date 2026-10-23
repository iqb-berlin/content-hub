import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { lastValueFrom } from "rxjs";
import { AcpFile, AcpFileProcessingJob } from "../database/entities";
import { ValidationService } from "../validation/validation.service";
import { FileProcessingJobsService } from "./file-processing-jobs.service";
import { FilesService } from "./files.service";
import { UnitParserService } from "./unit-parser.service";

describe("FileProcessingJobsService background failures", () => {
  it.each(["upload", "download"])(
    "reports a failed status write through the %s job stream",
    async (kind) => {
      const failure = new Error("database unavailable");
      const job = Object.assign(new AcpFileProcessingJob(), {
        id: "job-1",
        acpId: "acp-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const repository = {
        findOne: jest.fn().mockResolvedValue(job).mockResolvedValueOnce(null),
        create: jest.fn((input: Partial<AcpFileProcessingJob>) =>
          Object.assign(job, input),
        ),
        save: jest.fn().mockResolvedValueOnce(job).mockRejectedValue(failure),
      };
      const module = await Test.createTestingModule({
        providers: [
          FileProcessingJobsService,
          {
            provide: getRepositoryToken(AcpFileProcessingJob),
            useValue: repository,
          },
          {
            provide: getRepositoryToken(AcpFile),
            useValue: { find: jest.fn().mockResolvedValue([{ id: "file-1" }]) },
          },
          { provide: FilesService, useValue: {} },
          { provide: UnitParserService, useValue: {} },
          { provide: ValidationService, useValue: {} },
        ],
      }).compile();
      const log = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);
      try {
        const service = module.get(FileProcessingJobsService);
        const snapshot =
          kind === "upload"
            ? await service.createAndStartJob("acp-1", ["file-1"])
            : await service.createAndStartDownloadJob("acp-1", ["file-1"]);
        expect(snapshot.id).toBe("job-1");
        await expect(lastValueFrom(service.streamJob("job-1"))).rejects.toBe(
          failure,
        );
        expect(log).toHaveBeenCalledWith(
          "Failed to persist processing job status",
          failure,
        );
      } finally {
        log.mockRestore();
        await module.close();
      }
    },
  );
});
