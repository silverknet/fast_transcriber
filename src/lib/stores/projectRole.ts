/**
 * The signed-in user's role in the currently-open cloud project.
 *
 * `'owner'` can do everything, including changing a song's audio (a
 * destructive, project-wide action). `'editor'` can edit chords/sections but
 * NOT reupload/replace audio — see `AudioLockedDialog.svelte`. `null` means no
 * cloud project is open (a local-only project, where the single user is
 * effectively the owner) or the role couldn't be determined.
 */
import { writable } from 'svelte/store'
import { getCloudProjectManifest, type CloudMemberView } from '$lib/client/cloudSync'

export type ProjectRole = 'owner' | 'editor' | null

export const projectRole = writable<ProjectRole>(null)
/** Members of the open cloud project (for the header cloud chip). */
export const projectMembers = writable<CloudMemberView[]>([])

/** Fetch + cache the current user's role + member list for a cloud project. */
export async function loadProjectRole(
  cloudProjectId: string | null | undefined,
  userId: string | null | undefined,
): Promise<void> {
  if (!cloudProjectId || !userId) {
    projectRole.set(null)
    projectMembers.set([])
    return
  }
  try {
    const manifest = await getCloudProjectManifest(cloudProjectId)
    const members = manifest?.members ?? []
    projectMembers.set(members)
    const role = members.find((m) => m.user_id === userId)?.role
    projectRole.set(role === 'owner' || role === 'editor' ? role : null)
  } catch {
    projectRole.set(null)
    projectMembers.set([])
  }
}
