'use client'

import { useState, useTransition } from 'react'
import {
  Layers, Plus, Pencil, Trash2, Crown, ShieldCheck, Users, User,
  Building2, ChevronDown, ChevronUp, Search,
} from 'lucide-react'
import Link from 'next/link'
import { deleteClusterAction } from '@/app/dashboard/clusters/actions'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { ClusterDetail, ClusterRole, Department, User as PortalUser } from '@/types'

const ROLE_META: Record<ClusterRole, { label: string; icon: React.ReactNode; color: string }> = {
  owner:      { label: 'Cluster Owner',  icon: <Crown size={13} />,      color: '#F59E0B' },
  manager:    { label: 'Manager',        icon: <ShieldCheck size={13} />, color: '#2B7FFF' },
  supervisor: { label: 'Supervisor',     icon: <Users size={13} />,       color: '#8B5CF6' },
  member:     { label: 'Member',         icon: <User size={13} />,        color: '#10B981' },
}

interface Props {
  clusters: ClusterDetail[]
  departments: Department[]
  users: PortalUser[]
}

// ─── Cluster Card ─────────────────────────────────────────────────────────────
function ClusterCard({
  cluster,
  onDelete,
}: {
  cluster: ClusterDetail
  onDelete: (c: ClusterDetail) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const owner = cluster.members.find((m) => m.cluster_role === 'owner')
  const managers = cluster.members.filter((m) => m.cluster_role === 'manager')
  const supervisors = cluster.members.filter((m) => m.cluster_role === 'supervisor')
  const memberCount = cluster.members.length

  return (
    <div
      className="rounded-2xl overflow-hidden transition-all hover:shadow-lg"
      style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
    >
      {/* Color bar */}
      <div className="h-1.5 w-full" style={{ background: cluster.color }} />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: cluster.color + '20' }}
            >
              <Layers size={18} style={{ color: cluster.color }} />
            </div>
            <div>
              <h3 className="font-bold text-sm">{cluster.name}</h3>
              {cluster.description && (
                <p className="text-xs opacity-50 mt-0.5 line-clamp-1">{cluster.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Link
              href={`/dashboard/clusters/${cluster.id}`}
              className="p-1.5 rounded-lg opacity-50 hover:opacity-100 hover:bg-white/5 transition-all"
              title="Edit cluster"
            >
              <Pencil size={13} />
            </Link>
            <button
              onClick={() => onDelete(cluster)}
              className="p-1.5 rounded-lg opacity-50 hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all"
              title="Delete cluster"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex gap-3 mb-4">
          <Link
            href={`/dashboard/clusters/${cluster.id}?tab=departments`}
            className="flex-1 rounded-xl px-3 py-2 text-center hover:opacity-80 transition-opacity"
            style={{ background: cluster.color + '15', border: `1px solid ${cluster.color}30` }}
          >
            <p className="text-lg font-bold" style={{ color: cluster.color }}>{cluster.departments.length}</p>
            <p className="text-[10px] opacity-60">Departments</p>
          </Link>
          <Link
            href={`/dashboard/clusters/${cluster.id}?tab=members`}
            className="flex-1 rounded-xl px-3 py-2 text-center hover:opacity-80 transition-opacity"
            style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
          >
            <p className="text-lg font-bold">{memberCount}</p>
            <p className="text-[10px] opacity-60">Members</p>
          </Link>
        </div>

        {/* Leadership */}
        <div className="space-y-1.5 mb-3">
          {owner && (
            <div className="flex items-center gap-2">
              <span
                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{ background: '#F59E0B20', color: '#F59E0B' }}
              >
                <Crown size={10} /> Owner
              </span>
              <span className="text-xs opacity-70">{owner.username}</span>
            </div>
          )}
          {managers.length > 0 && (
            <div className="flex items-center gap-2">
              <span
                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{ background: '#2B7FFF20', color: '#2B7FFF' }}
              >
                <ShieldCheck size={10} /> {managers.length > 1 ? `${managers.length} Managers` : 'Manager'}
              </span>
              <span className="text-xs opacity-70 truncate">{managers.map((m) => m.username).join(', ')}</span>
            </div>
          )}
          {supervisors.length > 0 && (
            <div className="flex items-center gap-2">
              <span
                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{ background: '#8B5CF620', color: '#8B5CF6' }}
              >
                <Users size={10} /> {supervisors.length > 1 ? `${supervisors.length} Supervisors` : 'Supervisor'}
              </span>
              <span className="text-xs opacity-70 truncate">{supervisors.map((m) => m.username).join(', ')}</span>
            </div>
          )}
        </div>

        {/* Departments preview toggle */}
        {cluster.departments.length > 0 && (
          <button
            onClick={() => setExpanded((p) => !p)}
            className="mt-1 flex items-center gap-1 text-[10px] opacity-50 hover:opacity-80 transition-opacity"
          >
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {expanded ? 'Hide departments' : `${cluster.departments.length} department${cluster.departments.length !== 1 ? 's' : ''}`}
          </button>
        )}
        {expanded && (
          <div className="mt-2 flex gap-1 flex-wrap">
            {cluster.departments.map((d) => (
              <span
                key={d.id}
                className="text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: cluster.color + '18', color: cluster.color, border: `1px solid ${cluster.color}30` }}
              >
                {d.name}
              </span>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-4">
          <Link
            href={`/dashboard/clusters/${cluster.id}?tab=departments`}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-medium transition-all hover:opacity-80"
            style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
          >
            <Building2 size={12} />
            Departments
          </Link>
          <Link
            href={`/dashboard/clusters/${cluster.id}?tab=members`}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-medium transition-all hover:opacity-80"
            style={{ background: cluster.color + '18', border: `1px solid ${cluster.color}40`, color: cluster.color }}
          >
            <Users size={12} />
            Members
          </Link>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function ClustersPage({ clusters: initialClusters, departments, users }: Props) {
  const [clusters, setClusters] = useState<ClusterDetail[]>(initialClusters)
  const [deleteTarget, setDeleteTarget] = useState<ClusterDetail | null>(null)
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')

  function handleDelete() {
    if (!deleteTarget) return
    startTransition(async () => {
      await deleteClusterAction(deleteTarget.id)
      setClusters((prev) => prev.filter((c) => c.id !== deleteTarget.id))
      setDeleteTarget(null)
    })
  }

  const filtered = clusters.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.description?.toLowerCase().includes(search.toLowerCase()) ||
      c.departments.some((d) => d.name.toLowerCase().includes(search.toLowerCase())),
  )

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#2B7FFF,#1A6AE4)' }}
          >
            <Layers size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Clusters</h1>
            <p className="text-xs opacity-50">Group departments into halls / realms with custom routing</p>
          </div>
        </div>
        <Link
          href="/dashboard/clusters/new"
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(135deg,#2B7FFF,#1A6AE4)' }}
        >
          <Plus size={16} />
          New Cluster
        </Link>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
        <input
          className="w-full rounded-xl pl-9 pr-3 py-2 text-sm outline-none"
          style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)' }}
          placeholder="Search clusters…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 mb-6">
        {[
          { label: 'Total Clusters', value: clusters.length, color: '#2B7FFF' },
          { label: 'Total Departments', value: clusters.reduce((s, c) => s + c.departments.length, 0), color: '#14B8A6' },
          { label: 'Total Members', value: clusters.reduce((s, c) => s + c.members.length, 0), color: '#8B5CF6' },
          {
            label: 'Unclustered Depts',
            value: departments.filter((d) => !clusters.some((c) => c.departments.some((cd) => cd.id === d.id))).length,
            color: '#F59E0B',
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="flex-1 rounded-xl p-4"
            style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
          >
            <p className="text-2xl font-bold" style={{ color: stat.color }}>{stat.value}</p>
            <p className="text-xs opacity-50 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center py-20 opacity-40">
          <Layers size={40} className="mx-auto mb-3" />
          <p className="text-sm">
            {search ? 'No clusters match your search' : 'No clusters yet — create your first one'}
          </p>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map((cluster) => (
          <ClusterCard
            key={cluster.id}
            cluster={cluster}
            onDelete={setDeleteTarget}
          />
        ))}
      </div>

      {/* Delete confirm */}
      {deleteTarget && (
        <ConfirmDialog
          open
          title="Delete Cluster"
          description={`Delete "${deleteTarget.name}"? This will remove all department and member assignments. Tasks in this cluster will become unclustered.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          confirmLabel="Delete"
          danger
        />
      )}
    </div>
  )
}
