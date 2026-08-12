import { useConvex } from "convex/react";
import {
  Edit2,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldPlus,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { getConvexDomainErrorCode } from "@/convex/identity";
import { type ConvexAdminRole, loadConvexAdminRoles } from "@/convex/roles";
import {
  type ConvexAdminUser,
  type ConvexAdminUserInput,
  type ConvexAdminUserStatus,
  assignConvexAdminUserRole,
  createConvexAdminUser,
  loadConvexAdminUsersPage,
  removeConvexAdminUserRole,
  setConvexAdminUserStatus,
  updateConvexAdminUser,
} from "@/convex/users";
import { cn } from "@/lib/utils";

import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { ConfirmModal } from "../ui/confirm-modal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

function mutationFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "That user change conflicts with an existing account, role membership, or administrator safety rule.";
    case "VALIDATION_FAILED":
      return "The user name or email address is invalid.";
    case "WRITE_DISABLED":
      return "User changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    case "FORBIDDEN":
    case "AUTHENTICATION_REQUIRED":
      return "Administrator access is required.";
    default:
      return "The user change could not be saved.";
  }
}

function getInitials(name: string | null): string {
  if (name === null || name.trim().length === 0) {
    return "U";
  }
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);
}

function UserEditor({
  editingUser,
  isSaving,
  onClose,
  onSave,
}: {
  editingUser: ConvexAdminUser | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: ConvexAdminUserInput) => void;
}) {
  const [name, setName] = useState(editingUser?.name ?? "");
  const [email, setEmail] = useState(editingUser?.email ?? "");
  const [showErrors, setShowErrors] = useState(false);
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const isValid =
    trimmedName.length > 0 &&
    trimmedEmail.includes("@") &&
    !/\s/u.test(trimmedEmail);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {editingUser === null ? "Add New User" : "Edit User"}
          </DialogTitle>
          <DialogDescription>
            Canonical account ownership is linked separately through Clerk.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="convex-user-name">Full Name</Label>
            <Input
              aria-invalid={showErrors && trimmedName.length === 0}
              id="convex-user-name"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
            {showErrors && trimmedName.length === 0 && (
              <p className="text-xs text-destructive">Name is required.</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-user-email">Email Address</Label>
            <Input
              aria-invalid={showErrors && !isValid}
              id="convex-user-email"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
            {showErrors &&
              (trimmedEmail.length === 0 ||
                !trimmedEmail.includes("@") ||
                /\s/u.test(trimmedEmail)) && (
                <p className="text-xs text-destructive">
                  Enter a valid email address.
                </p>
              )}
          </div>
        </div>
        <DialogFooter>
          <Button disabled={isSaving} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={isSaving}
            onClick={() => {
              setShowErrors(true);
              if (isValid) {
                onSave({ name: trimmedName, email: trimmedEmail });
              }
            }}
          >
            {isSaving ? "Saving..." : "Save User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleMembershipEditor({
  isSaving,
  onAssign,
  onClose,
  onRemove,
  roles,
  user,
}: {
  isSaving: boolean;
  onAssign: (roleId: string) => void;
  onClose: () => void;
  onRemove: (membershipId: string) => void;
  roles: ConvexAdminRole[];
  user: ConvexAdminUser;
}) {
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const assignedRoleIds = new Set(
    user.roles.map((membership) => membership.role.id)
  );
  const availableRoles = roles.filter((role) => !assignedRoleIds.has(role.id));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Manage Roles</DialogTitle>
          <DialogDescription>
            {user.name ?? user.email ?? "This user"} receives capabilities only
            from these canonical role memberships.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-4">
          <div className="space-y-2">
            <Label>Assigned Roles</Label>
            {user.roles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No roles assigned.
              </p>
            ) : (
              user.roles.map((membership) => (
                <div
                  className="flex items-center justify-between rounded-md border p-3"
                  key={membership.id}
                >
                  <div>
                    <p className="font-medium">{membership.role.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {membership.role.description}
                    </p>
                  </div>
                  <Button
                    disabled={isSaving}
                    onClick={() => onRemove(membership.id)}
                    size="sm"
                    variant="outline"
                  >
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="convex-user-role">Assign Another Role</Label>
            {availableRoles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every available role is already assigned.
              </p>
            ) : (
              <div className="flex gap-2">
                <Select
                  onValueChange={setSelectedRoleId}
                  value={selectedRoleId}
                >
                  <SelectTrigger id="convex-user-role">
                    <SelectValue placeholder="Choose a role..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.name}
                        {role.admin ? " (Administrator)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={isSaving || selectedRoleId.length === 0}
                  onClick={() => onAssign(selectedRoleId)}
                >
                  Assign
                </Button>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button disabled={isSaving} onClick={onClose} variant="outline">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConvexUsersPage() {
  const convex = useConvex();
  const [users, setUsers] = useState<ConvexAdminUser[] | null>(null);
  const [roles, setRoles] = useState<ConvexAdminRole[] | null>(null);
  const [continueCursor, setContinueCursor] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("all");
  const [editingUser, setEditingUser] = useState<
    ConvexAdminUser | null | undefined
  >(undefined);
  const [roleUser, setRoleUser] = useState<ConvexAdminUser | null>(null);
  const [statusUser, setStatusUser] = useState<ConvexAdminUser | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);

    void Promise.all([
      loadConvexAdminUsersPage(convex, null),
      loadConvexAdminRoles(convex),
    ])
      .then(([userPage, roleList]) => {
        if (active) {
          setUsers(userPage.users);
          setContinueCursor(userPage.continueCursor);
          setIsDone(userPage.isDone);
          setRoles(roleList);
        }
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
        }
      });

    return () => {
      active = false;
    };
  }, [convex, revision]);

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return (users ?? []).filter((user) => {
      const matchesSearch =
        query.length === 0 ||
        user.name?.toLowerCase().includes(query) === true ||
        user.email?.toLowerCase().includes(query) === true;
      const matchesRole =
        selectedRoleId === "all" ||
        user.roles.some((membership) => membership.role.id === selectedRoleId);
      return matchesSearch && matchesRole;
    });
  }, [searchQuery, selectedRoleId, users]);

  const refresh = () => {
    setUsers(null);
    setRoles(null);
    setContinueCursor(null);
    setIsDone(true);
    setRevision((value) => value + 1);
  };

  const loadMore = () => {
    if (isDone || continueCursor === null || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    void loadConvexAdminUsersPage(convex, continueCursor)
      .then((nextPage) => {
        setUsers((current) => [...(current ?? []), ...nextPage.users]);
        setContinueCursor(nextPage.continueCursor);
        setIsDone(nextPage.isDone);
      })
      .catch(() => {
        toast.error("The next user page could not be loaded.");
      })
      .finally(() => {
        setIsLoadingMore(false);
      });
  };

  const saveUser = (input: ConvexAdminUserInput) => {
    const currentUser = editingUser;
    if (currentUser === undefined) {
      return;
    }
    setPendingAction(currentUser?.id ?? "create");
    void (
      currentUser === null
        ? createConvexAdminUser(convex, input)
        : updateConvexAdminUser(convex, currentUser.id, input)
    )
      .then(() => {
        toast.success(currentUser === null ? "User created." : "User updated.");
        setEditingUser(undefined);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  const changeStatus = (user: ConvexAdminUser) => {
    const status: ConvexAdminUserStatus =
      user.status === "active" ? "disabled" : "active";
    setPendingAction(user.id);
    void setConvexAdminUserStatus(convex, user.id, status)
      .then(() => {
        toast.success(status === "active" ? "User enabled." : "User disabled.");
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  const assignRole = (user: ConvexAdminUser, roleId: string) => {
    setPendingAction(user.id);
    void assignConvexAdminUserRole(convex, user.id, roleId)
      .then(() => {
        toast.success("Role assigned.");
        setRoleUser(null);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  const removeRole = (user: ConvexAdminUser, membershipId: string) => {
    setPendingAction(user.id);
    void removeConvexAdminUserRole(convex, membershipId)
      .then(() => {
        toast.success("Role removed.");
        setRoleUser(null);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  const activeRoleName = roles?.find(
    (role) => role.id === selectedRoleId
  )?.name;

  return (
    <>
      <Head>
        <title>Users - BBPC Admin</title>
      </Head>

      {editingUser !== undefined && (
        <UserEditor
          editingUser={editingUser}
          isSaving={pendingAction !== null}
          onClose={() => setEditingUser(undefined)}
          onSave={saveUser}
        />
      )}
      {roleUser !== null && roles !== null && (
        <RoleMembershipEditor
          isSaving={pendingAction !== null}
          onAssign={(roleId) => assignRole(roleUser, roleId)}
          onClose={() => setRoleUser(null)}
          onRemove={(membershipId) => removeRole(roleUser, membershipId)}
          roles={roles}
          user={roleUser}
        />
      )}
      <ConfirmModal
        confirmText={
          statusUser?.status === "active" ? "Disable user" : "Enable user"
        }
        description={
          statusUser === null
            ? ""
            : statusUser.status === "active"
            ? `Disable ${
                statusUser.name ?? statusUser.email ?? "this user"
              }? They will be unable to use BBPC until re-enabled.`
            : `Enable ${statusUser.name ?? statusUser.email ?? "this user"}?`
        }
        isOpen={statusUser !== null}
        onClose={() => setStatusUser(null)}
        onConfirm={() => {
          if (statusUser !== null) {
            changeStatus(statusUser);
          }
        }}
        title={statusUser?.status === "active" ? "Disable user" : "Enable user"}
        variant={statusUser?.status === "active" ? "destructive" : "default"}
      />

      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Users</h2>
            <p className="text-muted-foreground">
              Manage canonical accounts, status, and role memberships.
            </p>
          </div>
          <Button onClick={() => setEditingUser(null)}>
            <Plus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        </div>

        <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="bg-card pl-9"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search loaded users..."
              value={searchQuery}
            />
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
              <SelectTrigger className="w-full bg-card sm:w-[180px]">
                <div className="flex items-center gap-2">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue placeholder="Filter by Role" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                {roles?.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedRoleId !== "all" && (
              <Button
                onClick={() => setSelectedRoleId("all")}
                size="sm"
                variant="ghost"
              >
                <X className="mr-1 h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {selectedRoleId !== "all" && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Filtered by:
            </span>
            <Badge variant="secondary">
              {activeRoleName ?? "Unknown role"} · {filteredUsers.length}
            </Badge>
          </div>
        )}

        {loadFailed ? (
          <Card className="p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Users could not be loaded. No legacy SQL fallback was attempted.
            </p>
            <Button onClick={refresh} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </Card>
        ) : (
          <>
            <Card className="overflow-hidden border-none shadow-sm">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-[300px]">User</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead>Next Syllabus</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users === null && (
                    <TableRow>
                      <TableCell className="h-24 text-center" colSpan={5}>
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  )}
                  {users !== null && filteredUsers.length === 0 && (
                    <TableRow>
                      <TableCell className="h-36 text-center" colSpan={5}>
                        No loaded users match these filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredUsers.map((user) => (
                    <TableRow
                      className={cn(
                        "group",
                        user.status === "disabled" && "opacity-60"
                      )}
                      key={user.id}
                    >
                      <TableCell className="font-medium">
                        <Link
                          className="flex items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          href={`/user/${encodeURIComponent(user.id)}`}
                        >
                          <Avatar className="h-10 w-10 border shadow-sm">
                            <AvatarImage
                              alt={user.name ?? "User"}
                              src={user.image ?? ""}
                            />
                            <AvatarFallback className="bg-primary/5 text-xs font-bold text-primary">
                              {getInitials(user.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate">
                              {user.name ?? "Unnamed User"}
                            </span>
                            <span className="truncate text-xs font-normal text-muted-foreground">
                              {user.email ?? "No email"}
                            </span>
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            user.status === "active" ? "secondary" : "outline"
                          }
                        >
                          {user.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {user.roles.length === 0 ? (
                            <span className="text-xs text-muted-foreground">
                              No roles
                            </span>
                          ) : (
                            user.roles.map((membership) => (
                              <Badge
                                key={membership.id}
                                variant={
                                  membership.role.admin
                                    ? "destructive"
                                    : "secondary"
                                }
                              >
                                {membership.role.admin ? (
                                  <ShieldAlert className="mr-1 h-3 w-3" />
                                ) : (
                                  <UserCheck className="mr-1 h-3 w-3" />
                                )}
                                {membership.role.name}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {user.nextSyllabus?.movie.title ?? (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            aria-label={`Edit ${user.name ?? "user"}`}
                            disabled={pendingAction !== null}
                            onClick={() => setEditingUser(user)}
                            size="icon"
                            variant="ghost"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            aria-label={`Manage roles for ${
                              user.name ?? "user"
                            }`}
                            disabled={pendingAction !== null}
                            onClick={() => setRoleUser(user)}
                            size="icon"
                            variant="ghost"
                          >
                            <ShieldPlus className="h-4 w-4" />
                          </Button>
                          <Button
                            aria-label={`${
                              user.status === "active" ? "Disable" : "Enable"
                            } ${user.name ?? "user"}`}
                            disabled={pendingAction !== null}
                            onClick={() => setStatusUser(user)}
                            size="icon"
                            variant="ghost"
                          >
                            {user.status === "active" ? (
                              <UserX className="h-4 w-4 text-destructive" />
                            ) : (
                              <UserCheck className="h-4 w-4 text-primary" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Loaded {users?.length ?? 0} users
              </p>
              {!isDone && (
                <Button
                  disabled={isLoadingMore}
                  onClick={loadMore}
                  variant="outline"
                >
                  {isLoadingMore ? "Loading..." : "Load more"}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
