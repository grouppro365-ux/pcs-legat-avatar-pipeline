export function connectionRecord(connection, updatedAt = new Date().toISOString()) {
  if (!connection || typeof connection.id !== 'string' || !connection.id ||
      !Number.isSafeInteger(connection.user?.id) ||
      !Number.isSafeInteger(connection.user_chat_id) ||
      typeof connection.is_enabled !== 'boolean') {
    throw new Error('invalid_business_connection');
  }
  const rights = connection.rights && typeof connection.rights === 'object'
    ? connection.rights : {};
  return {
    connection_id: connection.id,
    business_user_id: connection.user.id,
    user_chat_id: connection.user_chat_id,
    rights,
    enabled: connection.is_enabled,
    can_reply: connection.is_enabled && rights.can_reply === true,
    can_read_messages: connection.is_enabled && rights.can_read_messages === true,
    updated_at: updatedAt
  };
}
