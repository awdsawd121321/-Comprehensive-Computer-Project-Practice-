package com.emobit.backend.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update

@Dao
interface ElderDao {
    @Query("SELECT * FROM elder_state WHERE elderId = :elderId LIMIT 1")
    suspend fun getElderState(elderId: String): ElderStateEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertElderState(entity: ElderStateEntity)
}

@Dao
interface EventDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertEvent(entity: EventEntity): Long

    @Query("SELECT COUNT(*) FROM events WHERE elderId = :elderId")
    suspend fun countForElder(elderId: String): Long

    @Query("DELETE FROM events WHERE id IN (SELECT id FROM events WHERE elderId = :elderId ORDER BY timestampMs DESC LIMIT -1 OFFSET :keep)")
    suspend fun trimToKeepNewest(elderId: String, keep: Int)
}

@Dao
interface MediaDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertMedia(entity: MediaEntity)

    @Query("SELECT * FROM media WHERE mediaId = :mediaId LIMIT 1")
    suspend fun getByMediaId(mediaId: String): MediaEntity?
}

