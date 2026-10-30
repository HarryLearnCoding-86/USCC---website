// src/components/user-management-panel.tsx
// Client UI for /admin/users: create accounts, deactivate / reactivate, reset passwords
// (SRS-AUTH-02, SRS-AUTH-07, BR-16). Server rules (last active TD, self-deactivation) are enforced by
// the API; this component only displays the Vietnamese message it returns.

"use client";

import { useState, type FormEvent } from "react";
import { vi } from "@/i18n/vi";
import { sendJsonMutation, type ApiErrorResponseBody } from "@/client/api-request";
import { DEFAULT_TIMEZONE, formatInstantInTimezone } from "@/server/domain/date-time-format";

/** Account row as returned by /api/users. */
export interface UserAccountRow {
  id: string;
  username: string;
  role: "TECHNICAL" | "RECORDER";
  isActive: boolean;
  createdAt: string;
}

/** Banner shown after an action. */
interface FeedbackMessage {
  isError: boolean;
  text: string;
}

/**
 * Account management panel.
 *
 * @param props.initialUsers - Accounts rendered on the server.
 * @param props.currentUserId - The TD viewing the page; their own deactivate button is hidden.
 * @returns The panel element.
 */
export function UserManagementPanel({
  initialUsers,
  currentUserId,
}: {
  initialUsers: UserAccountRow[];
  currentUserId: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [feedbackMessage, setFeedbackMessage] = useState<FeedbackMessage | null>(null);

  function replaceUser(updatedUser: UserAccountRow) {
    setUsers((currentUsers) => currentUsers.map((user) => (user.id === updatedUser.id ? updatedUser : user)));
  }

  async function changeUser(userId: string, change: { isActive: boolean } | { newPassword: string }, successText: string) {
    const result = await sendJsonMutation<{ user: UserAccountRow } & ApiErrorResponseBody>("PATCH", `/api/users/${userId}`, change);
    if (result.isOk) {
      replaceUser(result.body.user);
      setFeedbackMessage({ isError: false, text: successText });
    } else {
      setFeedbackMessage({ isError: true, text: result.body.messageVi ?? vi.common.error });
    }
  }

  function toggleActivation(user: UserAccountRow) {
    if (user.isActive) {
      if (!window.confirm(vi.adminUsers.deactivateConfirm(user.username))) {
        return;
      }
      void changeUser(user.id, { isActive: false }, vi.adminUsers.deactivateSuccess);
    } else {
      void changeUser(user.id, { isActive: true }, vi.adminUsers.activateSuccess);
    }
  }

  function resetPassword(user: UserAccountRow) {
    const newPassword = window.prompt(vi.adminUsers.newPasswordPrompt(user.username));
    if (newPassword) {
      void changeUser(user.id, { newPassword }, vi.adminUsers.resetPasswordSuccess);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <CreateUserForm
        onCreated={(createdUser) => {
          setUsers((currentUsers) => [...currentUsers, createdUser]);
          setFeedbackMessage({ isError: false, text: vi.adminUsers.createSuccess });
        }}
        onFailed={(text) => setFeedbackMessage({ isError: true, text })}
      />
      {feedbackMessage && (
        <p
          role={feedbackMessage.isError ? "alert" : "status"}
          className={`rounded-md px-3 py-2 text-sm ${feedbackMessage.isError ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"}`}
        >
          {feedbackMessage.text}
        </p>
      )}
      <UserTable
        users={users}
        currentUserId={currentUserId}
        onToggleActivation={toggleActivation}
        onResetPassword={resetPassword}
      />
    </div>
  );
}

/**
 * Form that creates a new account.
 *
 * @param props.onCreated - Called with the new account after a 201.
 * @param props.onFailed - Called with the server's Vietnamese message on failure.
 * @returns The form element.
 */
function CreateUserForm({
  onCreated,
  onFailed,
}: {
  onCreated: (createdUser: UserAccountRow) => void;
  onFailed: (text: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserAccountRow["role"]>("RECORDER");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitNewUser(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setIsSubmitting(true);
    try {
      const result = await sendJsonMutation<{ user: UserAccountRow } & ApiErrorResponseBody & { details?: { message: string }[] }>(
        "POST",
        "/api/users",
        { username, password, role },
      );
      if (result.isOk) {
        onCreated(result.body.user);
        setUsername("");
        setPassword("");
      } else {
        // Prefer the first field-level message (e.g. password too short) over the generic one.
        onFailed(result.body.details?.[0]?.message ?? result.body.messageVi ?? vi.common.error);
      }
    } catch {
      onFailed(vi.apiErrors.serverError);
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputClassName = "min-h-[44px] rounded-md border border-gray-300 px-3";
  return (
    <form onSubmit={submitNewUser} className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-4">
      <h2 className="font-semibold sm:col-span-4">{vi.adminUsers.createUserHeading}</h2>
      <label className="flex flex-col gap-1 text-sm">
        {vi.adminUsers.usernameLabel}
        <input name="new-username" value={username} onChange={(changeEvent) => setUsername(changeEvent.target.value)} className={inputClassName} autoCapitalize="none" required />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {vi.adminUsers.passwordLabel}
        <input name="new-password" type="password" autoComplete="new-password" value={password} onChange={(changeEvent) => setPassword(changeEvent.target.value)} className={inputClassName} required />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {vi.adminUsers.roleLabel}
        <select name="new-role" value={role} onChange={(changeEvent) => setRole(changeEvent.target.value as UserAccountRow["role"])} className={inputClassName}>
          <option value="RECORDER">{vi.roles.RECORDER}</option>
          <option value="TECHNICAL">{vi.roles.TECHNICAL}</option>
        </select>
      </label>
      <button type="submit" disabled={isSubmitting} className="btn-primary min-h-[44px] self-end">
        {vi.adminUsers.createUser}
      </button>
      <p className="text-xs text-gray-500 sm:col-span-4">{vi.adminUsers.usernameHint}</p>
    </form>
  );
}

/**
 * Table of accounts with per-row actions.
 *
 * @param props.users - Accounts to show.
 * @param props.currentUserId - Viewer's ID; their own deactivate button is hidden.
 * @param props.onToggleActivation - Deactivate or reactivate handler.
 * @param props.onResetPassword - Password reset handler.
 * @returns The table element.
 */
function UserTable({
  users,
  currentUserId,
  onToggleActivation,
  onResetPassword,
}: {
  users: UserAccountRow[];
  currentUserId: string;
  onToggleActivation: (user: UserAccountRow) => void;
  onResetPassword: (user: UserAccountRow) => void;
}) {
  if (users.length === 0) {
    return <p className="text-gray-600">{vi.adminUsers.noUsers}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-3 py-2">{vi.adminUsers.tableHeaderUsername}</th>
            <th className="px-3 py-2">{vi.adminUsers.tableHeaderRole}</th>
            <th className="px-3 py-2">{vi.adminUsers.tableHeaderStatus}</th>
            <th className="px-3 py-2">{vi.adminUsers.tableHeaderCreatedAt}</th>
            <th className="px-3 py-2">{vi.adminUsers.tableHeaderActions}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} data-testid={`user-row-${user.username}`} className="border-t border-gray-100">
              <td className="px-3 py-2 font-medium">{user.username}</td>
              <td className="px-3 py-2">{vi.roles[user.role]}</td>
              <td className="px-3 py-2">{user.isActive ? vi.adminUsers.isActiveOn : vi.adminUsers.isActiveOff}</td>
              <td className="px-3 py-2">{formatInstantInTimezone(new Date(user.createdAt), DEFAULT_TIMEZONE)}</td>
              <td className="flex flex-wrap gap-2 px-3 py-2">
                {user.id !== currentUserId && (
                  <button type="button" className="btn-secondary min-h-[44px]" onClick={() => onToggleActivation(user)}>
                    {user.isActive ? vi.adminUsers.deactivateUser : vi.adminUsers.activateUser}
                  </button>
                )}
                <button type="button" className="btn-secondary min-h-[44px]" onClick={() => onResetPassword(user)}>
                  {vi.adminUsers.resetPassword}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
