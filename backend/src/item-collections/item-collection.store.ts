import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import { ApItemPreference } from "../database/entities";
import { StablePreferenceIdentity } from "../item-preferences/preference-identity";
import { ItemCollectionState } from "./item-collection.models";

const COLLECTION_VIEW_ID = "item-explorer";

@Injectable()
export class ItemCollectionStore {
  constructor(
    @InjectRepository(ApItemPreference)
    private readonly itemPreferenceRepository: Repository<ApItemPreference>,
  ) {}

  async readPreferences(
    apId: string,
    identity: StablePreferenceIdentity,
  ): Promise<Record<string, unknown> | null> {
    const record = await this.itemPreferenceRepository.findOne({
      where: this.getIdentityWhere(apId, identity),
    });
    return record?.preferences || null;
  }

  async readSharedCollections(
    apId: string,
    identity: StablePreferenceIdentity,
    limit: number,
  ): Promise<Array<{ collection: unknown; ownerLabel: string }>> {
    const boundedLimit = Math.min(10_001, Math.max(1, Math.floor(limit)));
    const identityColumn =
      identity.kind === "user" ? "user_id" : "credential_id";
    const identityId =
      identity.kind === "user" ? identity.userId : identity.credentialId;
    const rows = await this.itemPreferenceRepository.query(
      `
        SELECT
          shared_collection.collection AS "collection",
          COALESCE(
            NULLIF(owner_user."display_name", ''),
            NULLIF(owner_user."username", ''),
            NULLIF(preference."credential_username", ''),
            NULLIF(owner_credential."username", ''),
            'Unbekannt'
          ) AS "ownerLabel"
        FROM "acp_item_preferences" preference
        LEFT JOIN "users" owner_user
          ON owner_user."id" = preference."user_id"
        LEFT JOIN "acp_credentials" owner_credential
          ON owner_credential."id" = preference."credential_id"
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(preference."preferences" -> 'collections') = 'array'
              THEN preference."preferences" -> 'collections'
            ELSE '[]'::jsonb
          END
        ) AS shared_collection(collection)
        WHERE preference."acp_id" = $1
          AND preference."view_id" = '${COLLECTION_VIEW_ID}'
          AND preference."${identityColumn}" IS DISTINCT FROM $2::uuid
          AND shared_collection.collection ->> 'shared' = 'true'
        ORDER BY
          COALESCE(shared_collection.collection ->> 'updatedAt', '') DESC,
          COALESCE(shared_collection.collection ->> 'id', '') ASC
        LIMIT $3
      `,
      [apId, identityId, boundedLimit],
    );
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      collection: row?.collection,
      ownerLabel:
        typeof row?.ownerLabel === "string" && row.ownerLabel.trim()
          ? row.ownerLabel.trim()
          : "Unbekannt",
    }));
  }

  async mutate(
    apId: string,
    identity: StablePreferenceIdentity,
    createIfMissing: boolean,
    mutation: (preferences: Record<string, unknown>) => ItemCollectionState,
  ): Promise<ItemCollectionState> {
    return this.itemPreferenceRepository.manager.transaction(
      async (manager) => {
        if (createIfMissing) {
          await this.insertIfMissing(manager, apId, identity);
        }

        const repository = manager.getRepository(ApItemPreference);
        const record = await repository.findOne({
          where: this.getIdentityWhere(apId, identity),
          lock: { mode: "pessimistic_write" },
        });
        if (!record) throw new NotFoundException("Item collection not found");

        const preferences = this.isRecord(record.preferences)
          ? { ...record.preferences }
          : {};
        const state = mutation(preferences);
        await manager.query(
          `
            UPDATE "acp_item_preferences"
            SET "preferences" = jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      CASE
                        WHEN jsonb_typeof("preferences") = 'object'
                          THEN "preferences"
                        ELSE '{}'::jsonb
                      END,
                      '{collections}',
                      $2::jsonb,
                      true
                    ),
                    '{activeCollectionId}',
                    $3::jsonb,
                    true
                  ),
                  '{collectionViewMode}',
                  $4::jsonb,
                  true
                ),
                "credential_username" = CASE
                  WHEN $5::varchar IS NOT NULL THEN $5::varchar
                  ELSE "credential_username"
                END,
                "updated_at" = now()
            WHERE "id" = $1
          `,
          [
            record.id,
            JSON.stringify(state.collections),
            JSON.stringify(state.activeCollectionId),
            JSON.stringify(state.collectionViewMode),
            identity.kind === "credential"
              ? identity.credentialUsername || null
              : null,
          ],
        );
        return state;
      },
    );
  }

  private async insertIfMissing(
    manager: EntityManager,
    apId: string,
    identity: StablePreferenceIdentity,
  ): Promise<void> {
    const identityColumn =
      identity.kind === "user" ? "user_id" : "credential_id";
    const identityPredicate = `"${identityColumn}" IS NOT NULL`;
    await manager.query(
      `
        INSERT INTO "acp_item_preferences" (
          "id", "acp_id", "view_id", "user_id", "credential_id",
          "credential_username", "preferences", "created_at", "updated_at"
        )
        VALUES (
          uuid_generate_v4(), $1, '${COLLECTION_VIEW_ID}', $2, $3, $4,
          '{"ui":{},"tags":{},"rowData":{}}'::jsonb, now(), now()
        )
        ON CONFLICT ("acp_id", "view_id", "${identityColumn}")
          WHERE ${identityPredicate}
        DO NOTHING
      `,
      [
        apId,
        identity.kind === "user" ? identity.userId : null,
        identity.kind === "credential" ? identity.credentialId : null,
        identity.kind === "credential"
          ? identity.credentialUsername || null
          : null,
      ],
    );
  }

  private getIdentityWhere(
    apId: string,
    identity: StablePreferenceIdentity,
  ): {
    apId: string;
    viewId: string;
    userId?: string;
    credentialId?: string;
  } {
    return {
      apId,
      viewId: COLLECTION_VIEW_ID,
      ...(identity.kind === "user"
        ? { userId: identity.userId }
        : { credentialId: identity.credentialId }),
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}
