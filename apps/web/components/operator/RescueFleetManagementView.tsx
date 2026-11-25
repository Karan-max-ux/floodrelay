'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type {
  RescueResource,
  ResourceStatus,
  ResourceType,
  VehicleCatalogModel,
  Shelter,
} from '@floodrelay/shared';
import { APPROVED_VEHICLE_CATALOG } from '@floodrelay/shared';
import { apiClient } from '@/lib/api/client';
import { useOperatorAuth } from '@/lib/auth/OperatorAuthContext';
import { hasPermission } from '@/lib/auth/permissions';
import { LiveStatusIndicator } from '@/components/operator/LiveStatusIndicator';

type FleetTab = 'roster' | 'add' | 'status';

export function RescueFleetManagementView({
  initialResources,
  initialLoading = true,
}: {
  initialResources?: RescueResource[];
  initialLoading?: boolean;
} = {}) {
  const { operator } = useOperatorAuth();
  const canManageResources = hasPermission(operator, 'MANAGE_RESOURCES');
  const canManageStatus = hasPermission(operator, 'MANAGE_RESOURCE_STATUS');

  // Navigation and view tabs
  const [activeTab, setActiveTab] = useState<FleetTab>('roster');

  // Roster data and state
  const [resources, setResources] = useState<RescueResource[]>(initialResources ?? []);
  const [vehicleModels, setVehicleModels] = useState<VehicleCatalogModel[]>([
    ...APPROVED_VEHICLE_CATALOG,
  ]);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(initialResources ? false : initialLoading);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [provenanceFilter, setProvenanceFilter] = useState<string>('ALL');

  // Add Vehicle Form State
  const [addModelId, setAddModelId] = useState<string>(
    APPROVED_VEHICLE_CATALOG[0]?.id || 'boat-irb-standard',
  );
  const [addCustomName, setAddCustomName] = useState<string>('');
  const [addIdMode, setAddIdMode] = useState<'auto' | 'custom'>('auto');
  const [addCustomId, setAddCustomId] = useState<string>('');
  const [addCapacity, setAddCapacity] = useState<number | string>(
    APPROVED_VEHICLE_CATALOG[0]?.defaultCapacity || 8,
  );
  const [addSpeedKmH, setAddSpeedKmH] = useState<number | string>(
    APPROVED_VEHICLE_CATALOG[0]?.defaultSpeedKmH || 25,
  );
  const [addLocationMode, setAddLocationMode] = useState<'depot' | 'coords'>('depot');
  const [addSelectedDepotId, setAddSelectedDepotId] = useState<string>('');
  const [addLat, setAddLat] = useState<string>('28.668');
  const [addLng, setAddLng] = useState<string>('77.232');
  const [addStatus, setAddStatus] = useState<'OFFLINE' | 'MAINTENANCE'>('OFFLINE');
  const [addNotes, setAddNotes] = useState<string>('');
  const [isSubmittingAdd, setIsSubmittingAdd] = useState<boolean>(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccessId, setAddSuccessId] = useState<string | null>(null);

  // Edit Vehicle Modal State
  const [editingResource, setEditingResource] = useState<RescueResource | null>(null);
  const [editName, setEditName] = useState<string>('');
  const [editModelId, setEditModelId] = useState<string>('');
  const [editCapacity, setEditCapacity] = useState<number | string>('');
  const [editSpeedKmH, setEditSpeedKmH] = useState<number | string>('');
  const [editLat, setEditLat] = useState<string>('');
  const [editLng, setEditLng] = useState<string>('');
  const [editDepotId, setEditDepotId] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [isSubmittingEdit, setIsSubmittingEdit] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Status Update Tab State
  const [statusSelectedResId, setStatusSelectedResId] = useState<string>('');
  const [statusTarget, setStatusTarget] = useState<'AVAILABLE' | 'MAINTENANCE' | 'OFFLINE'>(
    'AVAILABLE',
  );
  const [statusReason, setStatusReason] = useState<string>('');
  const [statusConfirmed, setStatusConfirmed] = useState<boolean>(false);
  const [isSubmittingStatus, setIsSubmittingStatus] = useState<boolean>(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusSuccessMsg, setStatusSuccessMsg] = useState<string | null>(null);

  // Global flash notification
  const [flashMessage, setFlashMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Load resources, vehicle catalog, and depots
  const fetchFleetData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [resList, modelsList] = await Promise.allSettled([
        apiClient.listResources(),
        apiClient.listVehicleModels(),
      ]);

      if (resList.status === 'fulfilled') {
        setResources(resList.value);
        setIsStale(false);
        setLastUpdated(new Date());
      } else {
        console.error('Failed to load resources:', resList.reason);
        setError((resList.reason as Error)?.message || 'Failed to load rescue resources');
        setIsStale(true);
      }

      if (modelsList.status === 'fulfilled' && modelsList.value.length > 0) {
        setVehicleModels(modelsList.value);
      }
    } catch (err) {
      console.error('Error fetching fleet data:', err);
      setError((err as Error).message || 'Failed to load fleet');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    void fetchFleetData();
  }, [fetchFleetData]);

  // Load shelters from demo or requests endpoint for depot selection
  useEffect(() => {
    // Known default staging relief depots in Delhi NCR
    setShelters([
      {
        id: 'shelter-kashmere-gate',
        name: 'Kashmere Gate Relief Camp & Depot',
        lat: 28.668,
        lng: 77.232,
        capacity: 120,
      },
      {
        id: 'shelter-wazirabad',
        name: 'Wazirabad Community Relief Centre',
        lat: 28.705,
        lng: 77.228,
        capacity: 150,
      },
      {
        id: 'shelter-mayur-vihar',
        name: 'Mayur Vihar Relief Staging Area',
        lat: 28.608,
        lng: 77.295,
        capacity: 200,
      },
      {
        id: 'shelter-ito',
        name: 'ITO Barrage Emergency Post',
        lat: 28.632,
        lng: 77.248,
        capacity: 80,
      },
    ]);
  }, []);

  // When selected catalog model changes in Add Form, update defaults
  useEffect(() => {
    const selectedModel = vehicleModels.find((m) => m.id === addModelId);
    if (selectedModel) {
      setAddCapacity(selectedModel.defaultCapacity);
      setAddSpeedKmH(selectedModel.defaultSpeedKmH);
      if (!addCustomName || vehicleModels.some((m) => m.name === addCustomName)) {
        setAddCustomName(selectedModel.name);
      }
    }
  }, [addModelId, vehicleModels, addCustomName]);

  // When depot changes in Add Form, update coordinates
  const handleAddDepotChange = (depotId: string) => {
    setAddSelectedDepotId(depotId);
    const d = shelters.find((s) => s.id === depotId);
    if (d) {
      setAddLat(d.lat.toString());
      setAddLng(d.lng.toString());
    }
  };

  // Filtered resources for Tab A Roster
  const filteredResources = useMemo(() => {
    return resources.filter((res) => {
      // Search
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase().trim();
        const matchName = res.name?.toLowerCase().includes(q);
        const matchId = res.id.toLowerCase().includes(q);
        const matchType = res.type.toLowerCase().includes(q);
        const matchModel = res.modelId?.toLowerCase().includes(q);
        if (!matchName && !matchId && !matchType && !matchModel) {
          return false;
        }
      }

      // Type filter
      if (typeFilter !== 'ALL' && res.type !== typeFilter) {
        return false;
      }

      // Status filter
      if (statusFilter !== 'ALL' && res.status !== statusFilter) {
        return false;
      }

      // Provenance filter
      if (provenanceFilter !== 'ALL' && res.source !== provenanceFilter) {
        return false;
      }

      return true;
    });
  }, [resources, searchQuery, typeFilter, statusFilter, provenanceFilter]);

  // Summary Metrics
  const metrics = useMemo(() => {
    const total = resources.length;
    const available = resources.filter((r) => r.status === 'AVAILABLE').length;
    const assignedOrRoute = resources.filter(
      (r) => r.status === 'ASSIGNED' || r.status === 'EN_ROUTE',
    ).length;
    const maintenanceOrOffline = resources.filter(
      (r) => r.status === 'MAINTENANCE' || r.status === 'OFFLINE',
    ).length;
    const real = resources.filter((r) => r.source === 'REAL').length;
    const simulated = resources.filter((r) => r.source === 'SIMULATED').length;

    return {
      total,
      available,
      assignedOrRoute,
      maintenanceOrOffline,
      real,
      simulated,
    };
  }, [resources]);

  // REAL resources available for manual status update dropdown
  const realResources = useMemo(() => {
    return resources.filter((r) => r.source === 'REAL');
  }, [resources]);

  // Handle Add Vehicle Form Submit
  const handleRegisterVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageResources) {
      setAddError('Access denied: ADMIN role required to register rescue vehicles.');
      return;
    }

    const latNum = parseFloat(addLat);
    const lngNum = parseFloat(addLng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      setAddError('Valid numeric latitude and longitude coordinates are required.');
      return;
    }

    const capNum = parseInt(addCapacity.toString(), 10);
    const speedNum = parseFloat(addSpeedKmH.toString());

    if (isNaN(capNum) || capNum <= 0) {
      setAddError('Passenger capacity must be a positive integer.');
      return;
    }

    if (isNaN(speedNum) || speedNum <= 0) {
      setAddError('Speed must be a positive number in km/h.');
      return;
    }

    setIsSubmittingAdd(true);
    setAddError(null);
    setAddSuccessId(null);

    try {
      const payload = {
        modelId: addModelId,
        name: addCustomName.trim() || undefined,
        id: addIdMode === 'custom' ? addCustomId.trim() : undefined,
        capacity: capNum,
        speedKmH: speedNum,
        lat: latNum,
        lng: lngNum,
        depotId: addLocationMode === 'depot' && addSelectedDepotId ? addSelectedDepotId : undefined,
        status: addStatus,
        notes: addNotes.trim() || undefined,
      };

      const result = await apiClient.registerResource(payload);
      setAddSuccessId(result.resource.id);
      setFlashMessage({
        type: 'success',
        text: `Vehicle "${result.resource.name}" successfully registered with ID ${result.resource.id}.`,
      });

      // Refresh roster
      await fetchFleetData();

      // Reset form fields
      setAddCustomId('');
      setAddNotes('');
    } catch (err: unknown) {
      console.error('Registration failed:', err);
      const msg = (err as Error)?.message || 'Failed to register rescue vehicle';
      setAddError(msg);
    } finally {
      setIsSubmittingAdd(false);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (res: RescueResource) => {
    if (res.source === 'SIMULATED') {
      setFlashMessage({
        type: 'error',
        text: `Simulated resource "${res.id}" cannot be edited. It serves as a benchmark fixture.`,
      });
      return;
    }
    setEditingResource(res);
    setEditName(res.name || '');
    setEditModelId(res.modelId || '');
    setEditCapacity(res.capacity);
    setEditSpeedKmH(res.speedKmH);
    setEditLat(res.lat.toString());
    setEditLng(res.lng.toString());
    setEditDepotId(res.depotId || '');
    setEditNotes(res.notes || '');
    setEditError(null);
  };

  // Handle Edit Submit
  const handleUpdateVehicleDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingResource || !canManageResources) return;

    const latNum = parseFloat(editLat);
    const lngNum = parseFloat(editLng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      setEditError('Valid numeric latitude and longitude coordinates are required.');
      return;
    }

    const capNum = parseInt(editCapacity.toString(), 10);
    const speedNum = parseFloat(editSpeedKmH.toString());

    setIsSubmittingEdit(true);
    setEditError(null);

    try {
      const payload = {
        name: editName.trim() || undefined,
        modelId: editModelId || undefined,
        capacity: capNum,
        speedKmH: speedNum,
        lat: latNum,
        lng: lngNum,
        depotId: editDepotId.trim() || null,
        notes: editNotes.trim() || null,
        expectedVersion: editingResource.version,
      };

      const result = await apiClient.updateResourceDetails(editingResource.id, payload);
      setFlashMessage({
        type: 'success',
        text: `Vehicle "${result.resource.name}" details updated successfully (v${result.resource.version}).`,
      });

      setEditingResource(null);
      await fetchFleetData();
    } catch (err: unknown) {
      console.error('Update failed:', err);
      setEditError((err as Error)?.message || 'Failed to update vehicle details');
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  // Handle Verify Vehicle
  const handleVerifyVehicle = async (res: RescueResource) => {
    if (!canManageResources || res.source === 'SIMULATED') return;
    try {
      await apiClient.verifyResource(res.id, 'Verified for operational dispatch');
      setFlashMessage({
        type: 'success',
        text: `Vehicle "${res.name || res.id}" verified successfully. It is now eligible for operational dispatch.`,
      });
      await fetchFleetData();
    } catch (err: unknown) {
      console.error('Verification failed:', err);
      setFlashMessage({
        type: 'error',
        text: (err as Error)?.message || 'Failed to verify vehicle',
      });
    }
  };

  // Open Status Dialog / Tab from Roster
  const handleOpenStatusForResource = (res: RescueResource) => {
    if (res.source === 'SIMULATED') {
      setFlashMessage({
        type: 'error',
        text: `Status mutations on simulated resource "${res.id}" are strictly blocked.`,
      });
      return;
    }
    setStatusSelectedResId(res.id);
    setStatusTarget(res.status === 'AVAILABLE' ? 'OFFLINE' : 'AVAILABLE');
    setStatusReason('');
    setStatusConfirmed(false);
    setStatusError(null);
    setStatusSuccessMsg(null);
    setActiveTab('status');
  };

  // Handle Status Update Submit
  const handleUpdateStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusSelectedResId || !canManageStatus) return;

    const targetRes = resources.find((r) => r.id === statusSelectedResId);
    if (!targetRes) {
      setStatusError('Please select a registered operational vehicle.');
      return;
    }

    if (targetRes.source === 'SIMULATED') {
      setStatusError(
        'Simulated resources are read-only. Status updates are restricted to authentic operational vehicles.',
      );
      return;
    }

    if (!statusConfirmed) {
      setStatusError('Please confirm the operational status change before dispatching.');
      return;
    }

    if (statusTarget === 'AVAILABLE' && targetRes.verificationStatus !== 'VERIFIED') {
      setStatusError(
        'Cannot set status to AVAILABLE: Vehicle has not been verified by an administrator. Verification is required before becoming dispatch-eligible.',
      );
      return;
    }

    setIsSubmittingStatus(true);
    setStatusError(null);
    setStatusSuccessMsg(null);

    try {
      const result = await apiClient.updateResourceStatus(statusSelectedResId, {
        status: statusTarget,
        reason: statusReason.trim() || `Status updated to ${statusTarget} via Fleet Management`,
      });

      setStatusSuccessMsg(
        `Resource "${result.resource.name || statusSelectedResId}" is now ${result.resource.status}. Operational event and audit entry recorded.`,
      );
      setFlashMessage({
        type: 'success',
        text: `Resource "${result.resource.name}" status changed to ${result.resource.status}.`,
      });

      await fetchFleetData();
      setStatusReason('');
      setStatusConfirmed(false);
    } catch (err: unknown) {
      console.error('Status update failed:', err);
      setStatusError((err as Error)?.message || 'Failed to update resource status');
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  // Status Badge Helper
  const renderStatusBadge = (status: ResourceStatus) => {
    switch (status) {
      case 'AVAILABLE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-600/40">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            AVAILABLE
          </span>
        );
      case 'ASSIGNED':
      case 'EN_ROUTE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-blue-950/60 text-blue-400 border border-blue-600/40">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
            {status}
          </span>
        );
      case 'MAINTENANCE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-950/60 text-amber-400 border border-amber-600/40">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            MAINTENANCE
          </span>
        );
      case 'OFFLINE':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-rose-950/60 text-rose-400 border border-rose-600/40">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            OFFLINE
          </span>
        );
    }
  };

  // Type Icon Helper
  const renderTypeIcon = (type: ResourceType) => {
    switch (type) {
      case 'BOAT':
        return (
          <span className="material-symbols-outlined text-[16px] text-cyan-400">
            directions_boat
          </span>
        );
      case 'HIGH_WATER_VEHICLE':
        return (
          <span className="material-symbols-outlined text-[16px] text-amber-400">
            local_shipping
          </span>
        );
      case 'AMBULANCE':
        return (
          <span className="material-symbols-outlined text-[16px] text-rose-400">emergency</span>
        );
      case 'HELICOPTER':
        return (
          <span className="material-symbols-outlined text-[16px] text-purple-400">flight</span>
        );
      default:
        return (
          <span className="material-symbols-outlined text-[16px] text-slate-400">commute</span>
        );
    }
  };

  const selectedVehicleForStatusDetails = useMemo(() => {
    return resources.find((r) => r.id === statusSelectedResId);
  }, [resources, statusSelectedResId]);

  return (
    <div className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1E3A5F] pb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-[#0066CC]/20 border border-[#0066CC]/40 text-blue-300 text-xs font-mono font-bold uppercase mb-2">
            <span className="material-symbols-outlined text-[14px]">directions_boat</span>
            <span>TACTICAL FLEET ASSETS</span>
          </div>
          <h1 className="text-2xl font-bold font-manrope text-white tracking-tight">
            Rescue Fleet Management
          </h1>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Operational vehicle inventory, database-backed registration, and lifecycle status
            control.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <LiveStatusIndicator
            status={isLoading ? 'REFRESHING' : isStale || error ? 'STALE' : 'UP_TO_DATE'}
            lastUpdated={lastUpdated}
            onRefresh={fetchFleetData}
            isRefreshing={isLoading}
          />
          {canManageResources && (
            <button
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                activeTab === 'add'
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-primary/20 hover:bg-primary/30 text-blue-200 border border-primary/40'
              }`}
              onClick={() => setActiveTab('add')}
              type="button"
              data-testid="add-vehicle-btn"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              <span>Register Vehicle</span>
            </button>
          )}
        </div>
      </div>

      {/* Global Flash Notification */}
      {flashMessage && (
        <div
          className={`p-3 rounded-lg text-xs flex items-center justify-between gap-2 border ${
            flashMessage.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
              : 'bg-rose-950/40 border-rose-500/50 text-rose-200'
          }`}
          role="alert"
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base">
              {flashMessage.type === 'success' ? 'check_circle' : 'error'}
            </span>
            <span>{flashMessage.text}</span>
          </div>
          <button
            className="p-1 hover:bg-white/10 rounded"
            onClick={() => setFlashMessage(null)}
            type="button"
          >
            <span className="material-symbols-outlined text-xs">close</span>
          </button>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-[#0A2540] border border-[#1E3A5F] rounded-xl p-3.5 space-y-1">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
            Total Fleet
          </span>
          <div className="text-2xl font-bold font-mono text-white">{metrics.total}</div>
          <div className="text-[10px] text-slate-400 flex items-center gap-1">
            <span>{metrics.real} Real</span>
            <span>•</span>
            <span className="text-amber-400">{metrics.simulated} Simulated</span>
          </div>
        </div>

        <div className="bg-[#0A2540] border border-[#1E3A5F] rounded-xl p-3.5 space-y-1">
          <span className="text-[11px] font-mono text-emerald-400 uppercase tracking-wider">
            Available (Ready)
          </span>
          <div className="text-2xl font-bold font-mono text-emerald-300">{metrics.available}</div>
          <div className="text-[10px] text-slate-400">Ready for dispatch</div>
        </div>

        <div className="bg-[#0A2540] border border-[#1E3A5F] rounded-xl p-3.5 space-y-1">
          <span className="text-[11px] font-mono text-blue-400 uppercase tracking-wider">
            In-Mission
          </span>
          <div className="text-2xl font-bold font-mono text-blue-300">
            {metrics.assignedOrRoute}
          </div>
          <div className="text-[10px] text-slate-400">Assigned / En Route</div>
        </div>

        <div className="bg-[#0A2540] border border-[#1E3A5F] rounded-xl p-3.5 space-y-1">
          <span className="text-[11px] font-mono text-rose-400 uppercase tracking-wider">
            Offline / Maint
          </span>
          <div className="text-2xl font-bold font-mono text-rose-300">
            {metrics.maintenanceOrOffline}
          </div>
          <div className="text-[10px] text-slate-400">Unavailable for tasks</div>
        </div>

        <div className="bg-[#0A2540] border border-[#1E3A5F] rounded-xl p-3.5 space-y-1">
          <span className="text-[11px] font-mono text-purple-400 uppercase tracking-wider">
            Access Tier
          </span>
          <div className="text-sm font-bold font-mono text-white mt-1">
            {operator?.role || 'ANONYMOUS'}
          </div>
          <div className="text-[10px] text-slate-400">
            {canManageResources
              ? 'Full Fleet Management'
              : canManageStatus
                ? 'Status Dispatch Only'
                : 'Read-Only Observer'}
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-[#1E3A5F] gap-2">
        <button
          className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'roster'
              ? 'bg-[#1E3A5F] text-white border-t border-x border-[#2E5A8F]'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
          onClick={() => setActiveTab('roster')}
          type="button"
          data-testid="tab-roster"
        >
          <span className="material-symbols-outlined text-sm">table_rows</span>
          <span>Fleet Roster ({filteredResources.length})</span>
        </button>

        {canManageResources && (
          <button
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'add'
                ? 'bg-[#1E3A5F] text-white border-t border-x border-[#2E5A8F]'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
            onClick={() => setActiveTab('add')}
            type="button"
            data-testid="tab-add"
          >
            <span className="material-symbols-outlined text-sm">add_circle</span>
            <span>Register New Vehicle</span>
          </button>
        )}

        {canManageStatus && (
          <button
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'status'
                ? 'bg-[#1E3A5F] text-white border-t border-x border-[#2E5A8F]'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
            onClick={() => setActiveTab('status')}
            type="button"
            data-testid="tab-status"
          >
            <span className="material-symbols-outlined text-sm">published_with_changes</span>
            <span>Update Vehicle Status</span>
          </button>
        )}
      </div>

      {/* TAB A — FLEET ROSTER */}
      {activeTab === 'roster' && (
        <div
          className="bg-[#0A2540] border border-[#1E3A5F] rounded-xl p-5 space-y-4 shadow-sm"
          data-testid="fleet-roster-view"
        >
          {/* Search & Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label
                className="block text-[11px] font-mono text-slate-300 mb-1"
                htmlFor="fleet-search"
              >
                Search Fleet
              </label>
              <div className="relative">
                <input
                  id="fleet-search"
                  className="w-full h-9 pl-8 pr-3 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs text-white placeholder:text-slate-500 focus:outline-hidden focus:ring-1 focus:ring-primary"
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by name, ID, or model..."
                  type="text"
                  value={searchQuery}
                />
                <span className="material-symbols-outlined absolute left-2.5 top-2.5 text-xs text-slate-400">
                  search
                </span>
              </div>
            </div>

            <div>
              <label
                className="block text-[11px] font-mono text-slate-300 mb-1"
                htmlFor="type-filter"
              >
                Vehicle Type
              </label>
              <select
                id="type-filter"
                className="w-full h-9 px-2.5 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-primary"
                onChange={(e) => setTypeFilter(e.target.value)}
                value={typeFilter}
              >
                <option value="ALL">All Types</option>
                <option value="BOAT">Rescue Boat</option>
                <option value="HIGH_WATER_VEHICLE">High-Water Vehicle</option>
                <option value="AMBULANCE">Ambulance</option>
                <option value="HELICOPTER">Rescue Helicopter</option>
              </select>
            </div>

            <div>
              <label
                className="block text-[11px] font-mono text-slate-300 mb-1"
                htmlFor="status-filter"
              >
                Operational Status
              </label>
              <select
                id="status-filter"
                className="w-full h-9 px-2.5 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-primary"
                onChange={(e) => setStatusFilter(e.target.value)}
                value={statusFilter}
              >
                <option value="ALL">All Statuses</option>
                <option value="AVAILABLE">Available</option>
                <option value="ASSIGNED">Assigned</option>
                <option value="EN_ROUTE">En Route</option>
                <option value="MAINTENANCE">Maintenance</option>
                <option value="OFFLINE">Offline</option>
              </select>
            </div>

            <div>
              <label
                className="block text-[11px] font-mono text-slate-300 mb-1"
                htmlFor="provenance-filter"
              >
                Provenance Boundary
              </label>
              <select
                id="provenance-filter"
                className="w-full h-9 px-2.5 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-primary"
                onChange={(e) => setProvenanceFilter(e.target.value)}
                value={provenanceFilter}
              >
                <option value="ALL">All Assets (Real + Simulated)</option>
                <option value="REAL">REAL Operational Vehicles</option>
                <option value="SIMULATED">SIMULATED Benchmark Assets</option>
              </select>
            </div>
          </div>

          {/* Roster Table */}
          {isLoading && resources.length === 0 ? (
            <div className="py-16 text-center text-slate-400 font-mono text-xs flex flex-col items-center justify-center gap-2">
              <span className="material-symbols-outlined animate-spin text-xl text-primary">
                progress_activity
              </span>
              <span>Loading authoritative rescue fleet roster...</span>
            </div>
          ) : filteredResources.length === 0 ? (
            <div className="py-16 text-center text-slate-400 font-mono text-xs border border-dashed border-[#1E3A5F] rounded-xl space-y-2">
              <span className="material-symbols-outlined text-2xl text-slate-500">
                directions_boat
              </span>
              <div>No rescue vehicles match current filters.</div>
              {canManageResources && (
                <button
                  className="mt-2 text-xs text-primary hover:underline font-sans"
                  onClick={() => setActiveTab('add')}
                  type="button"
                >
                  Register a new rescue vehicle &rarr;
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#1E3A5F] text-slate-400 font-mono text-[11px]">
                    <th className="pb-3 font-semibold">Vehicle ID & Name</th>
                    <th className="pb-3 font-semibold">Type</th>
                    <th className="pb-3 font-semibold">Capacity</th>
                    <th className="pb-3 font-semibold">Speed</th>
                    <th className="pb-3 font-semibold">Base / Location</th>
                    <th className="pb-3 font-semibold">Status</th>
                    <th className="pb-3 font-semibold">Verification</th>
                    <th className="pb-3 font-semibold">Provenance</th>
                    <th className="pb-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E3A5F]/40 font-mono text-xs">
                  {filteredResources.map((res) => {
                    const isSimulated = res.source === 'SIMULATED';
                    return (
                      <tr className="hover:bg-white/[0.02] transition-colors" key={res.id}>
                        <td className="py-3 font-bold text-white">
                          <span className="block font-sans text-xs">{res.name || res.id}</span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-slate-400 font-mono">{res.id}</span>
                            {res.version && (
                              <span className="text-[9px] font-mono text-slate-500">
                                v{res.version}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3 text-slate-300">
                          <div className="flex items-center gap-1.5">
                            {renderTypeIcon(res.type)}
                            <span>{res.type}</span>
                          </div>
                        </td>

                        <td className="py-3 text-slate-200">{res.capacity} pax</td>
                        <td className="py-3 text-slate-200">{res.speedKmH} km/h</td>

                        <td className="py-3 text-slate-300 font-sans">
                          {res.depotId ? (
                            <span className="text-[11px] font-mono text-blue-300">
                              {shelters.find((s) => s.id === res.depotId)?.name || res.depotId}
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono text-slate-400">
                              [{res.lat.toFixed(4)}, {res.lng.toFixed(4)}]
                            </span>
                          )}
                        </td>

                        <td className="py-3">{renderStatusBadge(res.status)}</td>

                        <td className="py-3">
                          {res.verificationStatus === 'VERIFIED' ? (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-500/30"
                              data-testid={`verification-badge-${res.id}`}
                            >
                              <span className="material-symbols-outlined text-[11px]">
                                verified
                              </span>
                              VERIFIED
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950/60 text-amber-300 border border-amber-500/30"
                              data-testid={`verification-badge-${res.id}`}
                              title="Pending physical inspection and operational verification"
                            >
                              <span className="material-symbols-outlined text-[11px]">pending</span>
                              UNVERIFIED
                            </span>
                          )}
                        </td>

                        <td className="py-3">
                          {res.source === 'REAL' ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-600/40">
                              REAL
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950/60 text-amber-400 border border-amber-600/40"
                              title="Synthetic benchmark asset — read-only"
                            >
                              SIMULATED
                            </span>
                          )}
                        </td>

                        <td className="py-3 text-right font-sans">
                          {isSimulated ? (
                            <span
                              className="text-[10px] font-mono text-slate-500 italic px-2 py-0.5 rounded bg-[#071829]"
                              title="Simulated resource — status and properties cannot be modified"
                            >
                              Read-only (Simulated)
                            </span>
                          ) : (
                            <div className="inline-flex items-center gap-1.5 justify-end">
                              {canManageResources && res.verificationStatus !== 'VERIFIED' && (
                                <button
                                  className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 text-[11px] font-semibold transition-colors flex items-center gap-1"
                                  onClick={() => handleVerifyVehicle(res)}
                                  type="button"
                                  data-testid={`verify-btn-${res.id}`}
                                >
                                  <span className="material-symbols-outlined text-[12px]">
                                    verified
                                  </span>
                                  Verify
                                </button>
                              )}
                              {canManageResources && (
                                <button
                                  className="px-2 py-1 rounded bg-[#071829] hover:bg-[#1E3A5F] text-blue-300 border border-[#1E3A5F] text-[11px] font-semibold transition-colors"
                                  onClick={() => handleOpenEdit(res)}
                                  type="button"
                                  data-testid={`edit-btn-${res.id}`}
                                >
                                  Edit
                                </button>
                              )}
                              {canManageStatus && (
                                <button
                                  className="px-2 py-1 rounded bg-primary/20 hover:bg-primary/30 text-blue-200 border border-primary/40 text-[11px] font-semibold transition-colors"
                                  onClick={() => handleOpenStatusForResource(res)}
                                  type="button"
                                  data-testid={`status-btn-${res.id}`}
                                >
                                  Status
                                </button>
                              )}
                              {!canManageResources && !canManageStatus && (
                                <span className="text-[10px] text-slate-500 italic">Read-only</span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB B — ADD NEW VEHICLE */}
      {activeTab === 'add' && (
        <div
          className="bg-[#0A2540] border border-[#1E3A5F] rounded-xl p-6 space-y-6 shadow-sm"
          data-testid="add-vehicle-form"
        >
          <div className="flex items-center justify-between border-b border-[#1E3A5F] pb-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-lg">add_circle</span>
                Register New Rescue Vehicle
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Add an authoritative physical asset to the Delhi NCR operational rescue fleet.
              </p>
            </div>
            <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-500/40 px-2 py-0.5 rounded">
              PROVENANCE: REAL
            </span>
          </div>

          {addError && (
            <div className="p-3 bg-rose-950/40 border border-rose-500/50 rounded-lg text-xs text-rose-200 flex items-start gap-2">
              <span className="material-symbols-outlined text-rose-400 text-base shrink-0 mt-0.5">
                error
              </span>
              <div>{addError}</div>
            </div>
          )}

          {addSuccessId && (
            <div className="p-4 bg-emerald-950/40 border border-emerald-500/50 rounded-xl text-xs text-emerald-200 space-y-2">
              <div className="flex items-center gap-2 font-bold text-emerald-300">
                <span className="material-symbols-outlined text-emerald-400">check_circle</span>
                <span>Vehicle Successfully Registered!</span>
              </div>
              <p>
                Assigned Vehicle ID:{' '}
                <code className="font-mono font-bold bg-black/40 px-1.5 py-0.5 rounded text-emerald-100">
                  {addSuccessId}
                </code>
                . Vehicle registered as <strong>{addStatus}</strong>.
              </p>
              <div className="pt-2 flex gap-2">
                <button
                  className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors"
                  onClick={() => setActiveTab('roster')}
                  type="button"
                >
                  View in Fleet Roster &rarr;
                </button>
                <button
                  className="px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-slate-200 text-xs transition-colors"
                  onClick={() => setAddSuccessId(null)}
                  type="button"
                >
                  Register Another Vehicle
                </button>
              </div>
            </div>
          )}

          <form className="space-y-6" onSubmit={handleRegisterVehicle}>
            {/* Field 1: Model Selection */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-200" htmlFor="vehicle-model">
                1. Vehicle Model & Category (Approved Catalog)
              </label>
              <select
                id="vehicle-model"
                className="w-full h-10 px-3 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs font-semibold text-white focus:outline-hidden focus:ring-1 focus:ring-primary"
                onChange={(e) => setAddModelId(e.target.value)}
                value={addModelId}
                required
              >
                {vehicleModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    [{m.category}] {m.name} ({m.type}) — Default {m.defaultCapacity} pax,{' '}
                    {m.defaultSpeedKmH} km/h
                  </option>
                ))}
              </select>
              {(() => {
                const selected = vehicleModels.find((m) => m.id === addModelId);
                return selected ? (
                  <p className="text-[11px] text-slate-400 italic leading-relaxed">
                    {selected.description} (Allowed limits: {selected.minCapacity}–
                    {selected.maxCapacity} passengers, {selected.minSpeedKmH}–{selected.maxSpeedKmH}{' '}
                    km/h).
                  </p>
                ) : null;
              })()}
            </div>

            {/* Custom Name */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-200" htmlFor="vehicle-name">
                Vehicle Call-Sign / Custom Name
              </label>
              <input
                id="vehicle-name"
                className="w-full h-10 px-3 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs text-white placeholder:text-slate-500 focus:outline-hidden focus:ring-1 focus:ring-primary"
                onChange={(e) => setAddCustomName(e.target.value)}
                placeholder="e.g. Engine 42 High-Water Unit"
                type="text"
                value={addCustomName}
              />
              <span className="text-[10px] text-slate-400">
                Defaults to catalog model name if left blank.
              </span>
            </div>

            {/* Field 2: Vehicle Identification */}
            <div className="space-y-3 bg-[#071829] border border-[#1E3A5F] rounded-xl p-4">
              <label className="block text-xs font-semibold text-slate-200">
                2. Vehicle Identification (Resource ID)
              </label>

              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    checked={addIdMode === 'auto'}
                    name="idMode"
                    onChange={() => setAddIdMode('auto')}
                    type="radio"
                    value="auto"
                  />
                  <span>Option A: Automatic ID (Recommended)</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    checked={addIdMode === 'custom'}
                    name="idMode"
                    onChange={() => setAddIdMode('custom')}
                    type="radio"
                    value="custom"
                  />
                  <span>Option B: Custom ID</span>
                </label>
              </div>

              {addIdMode === 'auto' ? (
                <div className="text-[11px] text-slate-400 bg-white/5 p-2.5 rounded-lg border border-white/5 font-mono">
                  &bull; Collision-resistant ID will be generated upon submission (e.g.{' '}
                  <span className="text-cyan-300 font-bold">res-7f3a91c2</span>). Enforces unique
                  database primary key constraint.
                </div>
              ) : (
                <div className="space-y-1">
                  <input
                    className="w-full h-10 px-3 rounded-lg bg-[#0A2540] border border-[#1E3A5F] text-xs font-mono text-cyan-300 placeholder:text-slate-500 focus:outline-hidden focus:ring-1 focus:ring-primary"
                    onChange={(e) => setAddCustomId(e.target.value)}
                    placeholder="e.g. res-delhi-boat-003"
                    required={addIdMode === 'custom'}
                    type="text"
                    value={addCustomId}
                  />
                  <span className="text-[10px] text-slate-400">
                    Alphanumeric, hyphens, and underscores only. Max 64 characters. Cannot be
                    altered post-registration.
                  </span>
                </div>
              )}
            </div>

            {/* Fields 3 & 4: Capacity & Speed */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label
                  className="block text-xs font-semibold text-slate-200"
                  htmlFor="add-capacity"
                >
                  3. Passenger Capacity (Evacuees)
                </label>
                <input
                  id="add-capacity"
                  className="w-full h-10 px-3 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs font-mono text-white focus:outline-hidden focus:ring-1 focus:ring-primary"
                  min={1}
                  max={100}
                  onChange={(e) => setAddCapacity(e.target.value)}
                  required
                  type="number"
                  value={addCapacity}
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-200" htmlFor="add-speed">
                  4. Vehicle Operational Speed (km/h)
                </label>
                <input
                  id="add-speed"
                  className="w-full h-10 px-3 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs font-mono text-white focus:outline-hidden focus:ring-1 focus:ring-primary"
                  min={1}
                  max={300}
                  step="any"
                  onChange={(e) => setAddSpeedKmH(e.target.value)}
                  required
                  type="number"
                  value={addSpeedKmH}
                />
              </div>
            </div>

            {/* Field 5: Location */}
            <div className="space-y-3 bg-[#071829] border border-[#1E3A5F] rounded-xl p-4">
              <label className="block text-xs font-semibold text-slate-200">
                5. Vehicle Base / Staging Location (Delhi NCR Service Area)
              </label>

              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    checked={addLocationMode === 'depot'}
                    name="locMode"
                    onChange={() => setAddLocationMode('depot')}
                    type="radio"
                    value="depot"
                  />
                  <span>Approved Staging Depot</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    checked={addLocationMode === 'coords'}
                    name="locMode"
                    onChange={() => setAddLocationMode('coords')}
                    type="radio"
                    value="coords"
                  />
                  <span>Manual Coordinates</span>
                </label>
              </div>

              {addLocationMode === 'depot' ? (
                <div className="space-y-2">
                  <select
                    className="w-full h-10 px-3 rounded-lg bg-[#0A2540] border border-[#1E3A5F] text-xs text-white focus:outline-hidden focus:ring-1 focus:ring-primary"
                    onChange={(e) => handleAddDepotChange(e.target.value)}
                    value={addSelectedDepotId}
                  >
                    <option value="">Select an approved relief camp / depot...</option>
                    {shelters.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} [{s.lat.toFixed(3)}, {s.lng.toFixed(3)}]
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-400 font-mono">Latitude</span>
                  <input
                    className="w-full h-9 px-3 rounded-lg bg-[#0A2540] border border-[#1E3A5F] text-xs font-mono text-white focus:outline-hidden focus:ring-1 focus:ring-primary"
                    onChange={(e) => setAddLat(e.target.value)}
                    placeholder="28.668"
                    required
                    step="any"
                    type="number"
                    value={addLat}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-400 font-mono">Longitude</span>
                  <input
                    className="w-full h-9 px-3 rounded-lg bg-[#0A2540] border border-[#1E3A5F] text-xs font-mono text-white focus:outline-hidden focus:ring-1 focus:ring-primary"
                    onChange={(e) => setAddLng(e.target.value)}
                    placeholder="77.232"
                    required
                    step="any"
                    type="number"
                    value={addLng}
                  />
                </div>
              </div>

              <div className="p-2 bg-amber-950/20 border border-amber-500/30 rounded-lg text-[11px] text-amber-300/90 flex items-start gap-1.5">
                <span className="material-symbols-outlined text-sm text-amber-400 shrink-0 mt-0.5">
                  info
                </span>
                <span>
                  <strong>DISCLAIMER:</strong> Manually entered coordinates specify the base, depot,
                  or last-reported staging position and do not represent continuous real-time
                  satellite GPS tracking. Coordinates are strictly verified against the approved
                  Delhi NCR PostGIS boundary.
                </span>
              </div>
            </div>

            {/* Field 6: Initial Status */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-200" htmlFor="add-status">
                6. Initial Operational Status
              </label>
              <select
                id="add-status"
                className="w-full h-10 px-3 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs font-semibold text-white focus:outline-hidden focus:ring-1 focus:ring-primary"
                onChange={(e) => setAddStatus(e.target.value as 'OFFLINE' | 'MAINTENANCE')}
                value={addStatus}
              >
                <option value="OFFLINE">
                  OFFLINE (Default — requires post-inspection activation)
                </option>
                <option value="MAINTENANCE">MAINTENANCE (Under mechanical preparation)</option>
              </select>
              <span className="text-[10px] text-slate-400 italic block">
                Newly registered vehicles default to OFFLINE. Authorised verification and status
                update to AVAILABLE is required before eligibility for rescue assignment dispatch.
              </span>
            </div>

            {/* Field 7: Registration Notes */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="block text-xs font-semibold text-slate-200" htmlFor="add-notes">
                  7. Operational Notes
                </label>
                <span className="text-[10px] text-slate-400 font-mono">{addNotes.length}/500</span>
              </div>
              <textarea
                id="add-notes"
                className="w-full h-20 p-3 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs text-white placeholder:text-slate-500 focus:outline-hidden focus:ring-1 focus:ring-primary resize-none"
                maxLength={500}
                onChange={(e) => setAddNotes(e.target.value)}
                placeholder="e.g. Equipped with high-output flood water bilge pump and 12 PFDs."
                value={addNotes}
              />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-[#1E3A5F]">
              <button
                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition-colors"
                onClick={() => setActiveTab('roster')}
                type="button"
              >
                Cancel
              </button>
              <button
                className="px-5 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                disabled={isSubmittingAdd}
                type="submit"
                data-testid="submit-register-btn"
              >
                {isSubmittingAdd ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-sm">
                      progress_activity
                    </span>
                    <span>Registering Vehicle...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">save</span>
                    <span>Register Physical Vehicle</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB C — UPDATE VEHICLE STATUS */}
      {activeTab === 'status' && (
        <div
          className="bg-[#0A2540] border border-[#1E3A5F] rounded-xl p-6 space-y-6 shadow-sm"
          data-testid="status-update-view"
        >
          <div className="flex items-center justify-between border-b border-[#1E3A5F] pb-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-lg">
                  published_with_changes
                </span>
                Operational Vehicle Status Transition
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Authorised availability and service readiness dispatch workflow with operational
                audit trail.
              </p>
            </div>
            <span className="text-[11px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-500/40 px-2 py-0.5 rounded">
              RBAC: MANAGE_RESOURCE_STATUS
            </span>
          </div>

          {statusError && (
            <div className="p-3 bg-rose-950/40 border border-rose-500/50 rounded-lg text-xs text-rose-200 flex items-start gap-2">
              <span className="material-symbols-outlined text-rose-400 text-base shrink-0 mt-0.5">
                error
              </span>
              <div>{statusError}</div>
            </div>
          )}

          {statusSuccessMsg && (
            <div className="p-4 bg-emerald-950/40 border border-emerald-500/50 rounded-xl text-xs text-emerald-200 flex items-start gap-2">
              <span className="material-symbols-outlined text-emerald-400 text-base shrink-0 mt-0.5">
                check_circle
              </span>
              <div>{statusSuccessMsg}</div>
            </div>
          )}

          <form className="space-y-5" onSubmit={handleUpdateStatus}>
            {/* Vehicle Selector */}
            <div className="space-y-1">
              <label
                className="block text-xs font-semibold text-slate-200"
                htmlFor="status-res-select"
              >
                Select Registered Operational Vehicle (REAL Only)
              </label>
              <select
                id="status-res-select"
                className="w-full h-10 px-3 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs font-semibold text-white focus:outline-hidden focus:ring-1 focus:ring-primary"
                onChange={(e) => setStatusSelectedResId(e.target.value)}
                required
                value={statusSelectedResId}
              >
                <option value="">Choose an authentic operational resource...</option>
                {realResources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name || r.id} ({r.id}) — {r.status}
                  </option>
                ))}
              </select>
            </div>

            {selectedVehicleForStatusDetails && (
              <div className="bg-[#071829] border border-[#1E3A5F] rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 font-mono block">Vehicle ID</span>
                  <span className="font-mono font-bold text-white">
                    {selectedVehicleForStatusDetails.id}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-mono block">Current Status</span>
                  {renderStatusBadge(selectedVehicleForStatusDetails.status)}
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-mono block">
                    Capacity & Speed
                  </span>
                  <span className="text-slate-200">
                    {selectedVehicleForStatusDetails.capacity} pax /{' '}
                    {selectedVehicleForStatusDetails.speedKmH} km/h
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-mono block">Record Version</span>
                  <span className="font-mono text-cyan-300">
                    v{selectedVehicleForStatusDetails.version || 1}
                  </span>
                </div>
              </div>
            )}

            {selectedVehicleForStatusDetails &&
              selectedVehicleForStatusDetails.verificationStatus !== 'VERIFIED' && (
                <div className="p-3 bg-amber-950/40 border border-amber-500/50 rounded-xl text-xs text-amber-200 flex items-start gap-2.5">
                  <span className="material-symbols-outlined text-amber-400 text-lg shrink-0 mt-0.5">
                    verified_user
                  </span>
                  <div className="space-y-1">
                    <span className="font-bold block text-amber-300">
                      Vehicle Verification Required
                    </span>
                    <p className="text-[11px] text-amber-200/90 leading-relaxed">
                      This vehicle is currently <strong className="font-mono">UNVERIFIED</strong>.
                      An administrator must verify physical readiness and inspection before the
                      vehicle can become dispatch-eligible (AVAILABLE).
                    </p>
                    {canManageResources && (
                      <button
                        type="button"
                        onClick={() => handleVerifyVehicle(selectedVehicleForStatusDetails)}
                        className="mt-1 px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-bold text-[11px] hover:bg-amber-400 transition-colors inline-flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[13px]">verified</span>
                        Verify Vehicle Now
                      </button>
                    )}
                  </div>
                </div>
              )}

            {/* Target Status */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-200" htmlFor="target-status">
                Target Operational Availability State
              </label>
              <select
                id="target-status"
                className="w-full h-10 px-3 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs font-semibold text-white focus:outline-hidden focus:ring-1 focus:ring-primary"
                onChange={(e) =>
                  setStatusTarget(e.target.value as 'AVAILABLE' | 'MAINTENANCE' | 'OFFLINE')
                }
                value={statusTarget}
              >
                <option
                  value="AVAILABLE"
                  disabled={selectedVehicleForStatusDetails?.verificationStatus !== 'VERIFIED'}
                >
                  AVAILABLE{' '}
                  {selectedVehicleForStatusDetails?.verificationStatus !== 'VERIFIED'
                    ? '(Blocked — Verification Required)'
                    : '(Eligible for assignment solver)'}
                </option>
                <option value="MAINTENANCE">MAINTENANCE (Servicing / Refueling)</option>
                <option value="OFFLINE">OFFLINE (Standby / Off-duty)</option>
              </select>
              <span className="text-[10px] text-slate-400 block">
                ASSIGNED and EN_ROUTE states are exclusively managed by the assignment solver and
                dispatch lifecycle.
              </span>
            </div>

            {/* Operational Reason */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-200" htmlFor="status-reason">
                Operational Reason / Log Entry
              </label>
              <input
                id="status-reason"
                className="w-full h-10 px-3 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs text-white placeholder:text-slate-500 focus:outline-hidden focus:ring-1 focus:ring-primary"
                onChange={(e) => setStatusReason(e.target.value)}
                placeholder="e.g. Pre-flight engine check complete; certified operational."
                required
                type="text"
                value={statusReason}
              />
            </div>

            {/* Confirmation Checkbox */}
            <div className="flex items-center gap-2 p-3 bg-white/5 border border-white/10 rounded-lg">
              <input
                checked={statusConfirmed}
                id="status-confirm-check"
                onChange={(e) => setStatusConfirmed(e.target.checked)}
                type="checkbox"
              />
              <label
                className="text-xs text-slate-300 cursor-pointer"
                htmlFor="status-confirm-check"
              >
                I verify that I am authorised to transition the availability status of this vehicle
                and that any downstream replanning events are accounted for.
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-[#1E3A5F]">
              <button
                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition-colors"
                onClick={() => setActiveTab('roster')}
                type="button"
              >
                Back to Roster
              </button>
              <button
                className="px-5 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                disabled={isSubmittingStatus || !statusSelectedResId || !statusConfirmed}
                type="submit"
                data-testid="submit-status-btn"
              >
                {isSubmittingStatus ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-sm">
                      progress_activity
                    </span>
                    <span>Updating Status...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">sync</span>
                    <span>Apply Operational Status Change</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* EDIT VEHICLE MODAL */}
      {editingResource && (
        <div
          aria-labelledby="edit-dialog-title"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in"
          role="dialog"
        >
          <div className="bg-[#0A2540] border border-[#1E3A5F] rounded-2xl w-full max-w-xl p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#1E3A5F] pb-3">
              <div>
                <h3
                  className="font-bold text-base text-white flex items-center gap-2"
                  id="edit-dialog-title"
                >
                  <span className="material-symbols-outlined text-primary">edit</span>
                  Edit Vehicle Details
                </h3>
                <span className="text-xs text-slate-400 font-mono">
                  Asset ID: <strong className="text-cyan-300">{editingResource.id}</strong> (v
                  {editingResource.version || 1})
                </span>
              </div>
              <button
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                onClick={() => setEditingResource(null)}
                type="button"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {editError && (
              <div className="p-3 bg-rose-950/40 border border-rose-500/50 rounded-lg text-xs text-rose-200 flex items-start gap-2">
                <span className="material-symbols-outlined text-rose-400 text-base shrink-0 mt-0.5">
                  error
                </span>
                <div>{editError}</div>
              </div>
            )}

            <form className="space-y-4" onSubmit={handleUpdateVehicleDetails}>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-200" htmlFor="edit-name">
                  Vehicle Name
                </label>
                <input
                  id="edit-name"
                  className="w-full h-10 px-3 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs text-white focus:outline-hidden focus:ring-1 focus:ring-primary"
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  type="text"
                  value={editName}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-200" htmlFor="edit-model">
                  Vehicle Catalog Model
                </label>
                <select
                  id="edit-model"
                  className="w-full h-10 px-3 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs text-white focus:outline-hidden focus:ring-1 focus:ring-primary"
                  onChange={(e) => setEditModelId(e.target.value)}
                  value={editModelId}
                >
                  <option value="">Keep current model / type</option>
                  {vehicleModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      [{m.category}] {m.name} ({m.type})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-200" htmlFor="edit-cap">
                    Capacity (Pax)
                  </label>
                  <input
                    id="edit-cap"
                    className="w-full h-10 px-3 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs font-mono text-white focus:outline-hidden focus:ring-1 focus:ring-primary"
                    min={1}
                    max={100}
                    onChange={(e) => setEditCapacity(e.target.value)}
                    required
                    type="number"
                    value={editCapacity}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-200" htmlFor="edit-speed">
                    Speed (km/h)
                  </label>
                  <input
                    id="edit-speed"
                    className="w-full h-10 px-3 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs font-mono text-white focus:outline-hidden focus:ring-1 focus:ring-primary"
                    min={1}
                    max={300}
                    step="any"
                    onChange={(e) => setEditSpeedKmH(e.target.value)}
                    required
                    type="number"
                    value={editSpeedKmH}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-200" htmlFor="edit-lat">
                    Latitude
                  </label>
                  <input
                    id="edit-lat"
                    className="w-full h-10 px-3 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs font-mono text-white focus:outline-hidden focus:ring-1 focus:ring-primary"
                    onChange={(e) => setEditLat(e.target.value)}
                    required
                    step="any"
                    type="number"
                    value={editLat}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-200" htmlFor="edit-lng">
                    Longitude
                  </label>
                  <input
                    id="edit-lng"
                    className="w-full h-10 px-3 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs font-mono text-white focus:outline-hidden focus:ring-1 focus:ring-primary"
                    onChange={(e) => setEditLng(e.target.value)}
                    required
                    step="any"
                    type="number"
                    value={editLng}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-200" htmlFor="edit-notes">
                  Operational Notes
                </label>
                <textarea
                  id="edit-notes"
                  className="w-full h-16 p-2.5 rounded-lg bg-[#071829] border border-[#1E3A5F] text-xs text-white placeholder:text-slate-500 focus:outline-hidden focus:ring-1 focus:ring-primary resize-none"
                  maxLength={500}
                  onChange={(e) => setEditNotes(e.target.value)}
                  value={editNotes}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#1E3A5F]">
                <button
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition-colors"
                  onClick={() => setEditingResource(null)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="px-5 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  disabled={isSubmittingEdit}
                  type="submit"
                  data-testid="submit-edit-btn"
                >
                  {isSubmittingEdit ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-sm">
                        progress_activity
                      </span>
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
