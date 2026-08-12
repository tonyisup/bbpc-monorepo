import { useConvex } from "convex/react";
import {
  Edit2,
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import Head from "next/head";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  type ConvexAdminRole,
  type ConvexAdminRoleInput,
  createConvexAdminRole,
  deleteConvexAdminRole,
  loadConvexAdminRoles,
  updateConvexAdminRole,
} from "@/convex/roles";
import { getConvexDomainErrorCode } from "@/convex/identity";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
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
      return "That role change conflicts with existing users or administrator safety rules.";
    case "VALIDATION_FAILED":
      return "The role name or description is invalid.";
    case "WRITE_DISABLED":
      return "Role changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    case "FORBIDDEN":
    case "AUTHENTICATION_REQUIRED":
      return "Administrator access is required.";
    default:
      return "The role change could not be saved.";
  }
}

function RoleEditor({
  editingRole,
  isSaving,
  onClose,
  onSave,
}: {
  editingRole: ConvexAdminRole | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: ConvexAdminRoleInput) => void;
}) {
  const [name, setName] = useState(editingRole?.name ?? "");
  const [description, setDescription] = useState(
    editingRole?.description ?? ""
  );
  const [admin, setAdmin] = useState(editingRole?.admin ?? false);
  const [showErrors, setShowErrors] = useState(false);
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const isValid = trimmedName.length > 0 && trimmedDescription.length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {editingRole === null ? "Add New Role" : "Edit Role"}
          </DialogTitle>
          <DialogDescription>
            Administrator roles grant full access to migrated admin tools.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="convex-role-name">Role Name</Label>
            <Input
              aria-invalid={showErrors && trimmedName.length === 0}
              id="convex-role-name"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
            {showErrors && trimmedName.length === 0 && (
              <p className="text-xs text-destructive">Role name is required.</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-role-description">Description</Label>
            <Input
              aria-invalid={showErrors && trimmedDescription.length === 0}
              id="convex-role-description"
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
            {showErrors && trimmedDescription.length === 0 && (
              <p className="text-xs text-destructive">
                Description is required.
              </p>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              checked={admin}
              id="convex-role-admin"
              onCheckedChange={(checked) => setAdmin(checked === true)}
            />
            <Label htmlFor="convex-role-admin">
              Administrator (Full Access)
            </Label>
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
                onSave({
                  name: trimmedName,
                  description: trimmedDescription,
                  admin,
                });
              }
            }}
          >
            {isSaving ? "Saving..." : "Save Role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConvexRolesPage() {
  const convex = useConvex();
  const [roles, setRoles] = useState<ConvexAdminRole[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editingRole, setEditingRole] = useState<
    ConvexAdminRole | null | undefined
  >(undefined);
  const [deletingRole, setDeletingRole] = useState<ConvexAdminRole | null>(
    null
  );
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);

    void loadConvexAdminRoles(convex)
      .then((result) => {
        if (active) {
          setRoles(result);
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

  const refresh = () => {
    setRoles(null);
    setRevision((value) => value + 1);
  };

  const saveRole = (input: ConvexAdminRoleInput) => {
    const currentRole = editingRole;
    if (currentRole === undefined) {
      return;
    }
    const actionKey = currentRole?.id ?? "create";
    setPendingAction(actionKey);
    void (
      currentRole === null
        ? createConvexAdminRole(convex, input)
        : updateConvexAdminRole(convex, currentRole.id, input)
    )
      .then(() => {
        toast.success(currentRole === null ? "Role created." : "Role updated.");
        setEditingRole(undefined);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  const deleteRole = (role: ConvexAdminRole) => {
    setPendingAction(role.id);
    void deleteConvexAdminRole(convex, role.id)
      .then(() => {
        toast.success("Role deleted.");
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  return (
    <>
      <Head>
        <title>Roles - BBPC Admin</title>
      </Head>

      {editingRole !== undefined && (
        <RoleEditor
          editingRole={editingRole}
          isSaving={pendingAction !== null}
          onClose={() => setEditingRole(undefined)}
          onSave={saveRole}
        />
      )}
      <ConfirmModal
        confirmText="Delete role"
        description={
          deletingRole === null
            ? ""
            : `Delete “${deletingRole.name}”? This cannot be undone.`
        }
        isOpen={deletingRole !== null}
        onClose={() => setDeletingRole(null)}
        onConfirm={() => {
          if (deletingRole !== null) {
            deleteRole(deletingRole);
          }
        }}
        title="Delete role"
      />

      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Roles</h2>
            <p className="text-muted-foreground">
              Manage canonical user roles and administrator capability.
            </p>
          </div>
          <Button onClick={() => setEditingRole(null)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Role
          </Button>
        </div>

        {loadFailed ? (
          <div className="rounded-md border bg-card p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Roles could not be loaded. No legacy SQL fallback was attempted.
            </p>
            <Button onClick={refresh} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : (
          <div className="rounded-md border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-center">Users</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles === null && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={5}>
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )}
                {roles?.length === 0 && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={5}>
                      No roles found.
                    </TableCell>
                  </TableRow>
                )}
                {roles?.map((role) => {
                  const canDelete =
                    role.userCountIsExact && role.userCount === 0;
                  return (
                    <TableRow className="group" key={role.id}>
                      <TableCell className="font-bold">
                        <div className="flex items-center gap-2">
                          {role.admin ? (
                            <ShieldCheck className="h-4 w-4 text-primary" />
                          ) : (
                            <Shield className="h-4 w-4 text-muted-foreground" />
                          )}
                          {role.name}
                        </div>
                      </TableCell>
                      <TableCell>{role.description}</TableCell>
                      <TableCell>
                        <span className="rounded border bg-muted px-2 py-1 text-xs font-semibold uppercase tracking-wider">
                          {role.admin ? "Admin" : "Member"}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-muted px-1.5 font-mono text-xs font-bold">
                          {role.userCount}
                          {!role.userCountIsExact && "+"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            aria-label={`Edit ${role.name}`}
                            disabled={pendingAction !== null}
                            onClick={() => setEditingRole(role)}
                            size="icon"
                            variant="ghost"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            aria-label={`Delete ${role.name}`}
                            disabled={!canDelete || pendingAction !== null}
                            onClick={() => setDeletingRole(role)}
                            size="icon"
                            title={
                              canDelete
                                ? "Delete role"
                                : "Remove all assigned users before deleting this role."
                            }
                            variant="ghost"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  );
}
