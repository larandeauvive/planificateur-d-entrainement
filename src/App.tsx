import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Upload, Download, Plus, Trash2, Edit2, CheckCircle2, Circle, Calendar, Activity, AlignLeft, Save, FileSpreadsheet, Dumbbell, Trophy, LayoutDashboard, FileText, Flag, MessageSquare, Cloud, Camera, Link as LinkIcon, History, Apple, Droplets, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import Papa from 'papaparse';
import { toPng } from 'html-to-image';
import { format, parseISO, isValid, startOfWeek, addDays, differenceInDays, startOfDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { db } from './firebase';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';

interface Session {
  id: string;
  date: string;
  type: string;
  description: string;
  completed: boolean;
  sensations?: string;
  suuntoLink?: string;
  sessionNutrition?: string;
  dailyNutrition?: string;
  dailyHydration?: string;
  macrocycle?: string;
  mesocycle?: string;
  microcycle?: string;
}

interface Race {
  id: string;
  name: string;
  date: string;
  isMainObjective?: boolean;
}

interface Profile {
  id: string;
  name: string;
}

export default function App() {
  const [profiles, setProfiles] = useState<Profile[]>(() => {
    const saved = localStorage.getItem('fitplan-profiles');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { return [{ id: 'global-plan', name: 'Mon Profil' }]; }
    }
    return [{ id: 'global-plan', name: 'Mon Profil' }];
  });

  const [activeProfileId, setActiveProfileId] = useState<string>(() => {
    return localStorage.getItem('fitplan-active-profile') || 'global-plan';
  });

  const [activeTab, setActiveTab] = useState<'programme' | 'courses' | 'import'>('programme');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCloudLoaded, setIsCloudLoaded] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [showPastWeeks, setShowPastWeeks] = useState(false);
  const [confirmDeleteWeek, setConfirmDeleteWeek] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<'add' | 'replace'>('replace');

  const toggleSessionExpansion = (id: string) => {
    setExpandedSessions(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [sessions, setSessions] = useState<Session[]>(() => {
    const saved = localStorage.getItem(`fitplan-sessions-${activeProfileId}`);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { return []; }
    }
    return [];
  });

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todaysSessions = useMemo(() => sessions.filter(s => s.date === todayStr), [sessions, todayStr]);

  const [races, setRaces] = useState<Race[]>(() => {
    const saved = localStorage.getItem(`fitplan-races-${activeProfileId}`);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { return []; }
    }
    return [];
  });

  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Session>>({});
  const [isGeneratingNutrition, setIsGeneratingNutrition] = useState(false);
  const [csvInput, setCsvInput] = useState('');
  const [newRace, setNewRace] = useState({ name: '', date: '' });
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateData = async (newSessions: Session[], newRaces: Race[], profileId: string = activeProfileId) => {
    setSessions(newSessions);
    setRaces(newRaces);
    localStorage.setItem(`fitplan-sessions-${profileId}`, JSON.stringify(newSessions));
    localStorage.setItem(`fitplan-races-${profileId}`, JSON.stringify(newRaces));
    
    setIsSyncing(true);
    try {
      await setDoc(doc(db, 'plans', profileId), {
        sessions: newSessions,
        races: newRaces,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error syncing to cloud:", error);
    } finally {
      setIsSyncing(false);
    }
  };

  // 1. Listen to Firestore for active profile data
  useEffect(() => {
    if (!activeProfileId) return;
    setIsCloudLoaded(false);
    
    const unsubscribe = onSnapshot(doc(db, 'plans', activeProfileId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const cloudSessions = data.sessions || [];
        const cloudRaces = data.races || [];
        
        setSessions(cloudSessions);
        setRaces(cloudRaces);
        localStorage.setItem(`fitplan-sessions-${activeProfileId}`, JSON.stringify(cloudSessions));
        localStorage.setItem(`fitplan-races-${activeProfileId}`, JSON.stringify(cloudRaces));
      } else {
        // If cloud is empty, try to load local data or upload empty
        const localSessions = JSON.parse(localStorage.getItem(`fitplan-sessions-${activeProfileId}`) || '[]');
        const localRaces = JSON.parse(localStorage.getItem(`fitplan-races-${activeProfileId}`) || '[]');
        setSessions(localSessions);
        setRaces(localRaces);
        if (localSessions.length > 0 || localRaces.length > 0) {
          updateData(localSessions, localRaces, activeProfileId);
        }
      }
      setIsCloudLoaded(true);
    }, (error) => {
      console.error("Firestore Error:", error);
      setIsCloudLoaded(true);
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfileId]);

  // 2. Listen to Firestore for profiles list
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'plans', 'metadata'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.profiles && Array.isArray(data.profiles)) {
          setProfiles(data.profiles);
          localStorage.setItem('fitplan-profiles', JSON.stringify(data.profiles));
        }
      } else {
        // Initialize metadata with current profiles if it doesn't exist
        setDoc(doc(db, 'plans', 'metadata'), { profiles });
      }
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deleteWeekSessions = (weekStart: Date) => {
    const weekEnd = addDays(weekStart, 6);
    const newSessions = sessions.filter(s => {
      const d = parseISO(s.date);
      return d < weekStart || d > weekEnd;
    });
    updateData(newSessions, races);
  };

  const processCsvData = (data: any[]) => {
    const imported: Session[] = data.map((row: any) => ({
      id: crypto.randomUUID(),
      date: typeof row.date === 'string' ? (row.date.includes('/') ? row.date.split('/').reverse().join('-') : row.date) : row.Date || format(new Date(), 'yyyy-MM-dd'),
      type: row.Type || row.type || '',
      description: row.Description || row.description || row.Déroulement || row.deroulement || '',
      sensations: row.Sensations || row.sensations || row.Ressenti || row.ressenti || '',
      suuntoLink: row['Lien Suunto'] || row.suuntoLink || row.Suunto || '',
      sessionNutrition: row['Conseil séance'] || row.sessionNutrition || '',
      dailyNutrition: row['Nutrition journée'] || row.dailyNutrition || '',
      dailyHydration: row['Hydratation journée'] || row.dailyHydration || '',
      macrocycle: row.Macrocycle || row.macrocycle || '',
      mesocycle: row.Mesocycle || row.mesocycle || '',
      microcycle: row.Microcycle || row.microcycle || row.Pilier || row.pilier || '',
      completed: (row.Terminé || row.termine || row.Completed || '').toUpperCase() === 'OUI'
    })).filter(s => s.date);

    let baseSessions = [...sessions];
    if (importMode === 'replace') {
      const importedDates = new Set(imported.map(s => s.date));
      baseSessions = baseSessions.filter(s => !importedDates.has(s.date));
    }

    const combined = [...baseSessions, ...imported].sort((a, b) => a.date.localeCompare(b.date));
    updateData(combined, races);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        processCsvData(results.data);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setActiveTab('programme');
      }
    });
  };

  const handleTextCsvImport = () => {
    if (!csvInput.trim()) return;
    Papa.parse(csvInput, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        processCsvData(results.data);
        setCsvInput('');
        setActiveTab('programme');
      }
    });
  };

  const handleExport = () => {
    const data = sessions.map(s => ({
      Date: s.date,
      Type: s.type,
      Description: s.description,
      Sensations: s.sensations || '',
      Macrocycle: s.macrocycle || '',
      Mesocycle: s.mesocycle || '',
      Microcycle: s.microcycle || '',
      'Conseil séance': s.sessionNutrition || '',
      'Nutrition journée': s.dailyNutrition || '',
      'Hydratation journée': s.dailyHydration || '',
      'Lien Suunto': s.suuntoLink || '',
      Terminé: s.completed ? 'OUI' : 'NON'
    }));
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'programme_entrainement.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportHistory = () => {
    const pastSessions = sessions.filter(s => {
      const sessionDate = parseISO(s.date);
      return isValid(sessionDate) && sessionDate < startOfDay(new Date()) && s.completed;
    });

    const data = pastSessions.map(s => ({
      Date: s.date,
      Type: s.type,
      Description: s.description,
      Sensations: s.sensations || '',
      Macrocycle: s.macrocycle || '',
      Mesocycle: s.mesocycle || '',
      Microcycle: s.microcycle || '',
      'Conseil séance': s.sessionNutrition || '',
      'Nutrition journée': s.dailyNutrition || '',
      'Hydratation journée': s.dailyHydration || '',
      'Lien Suunto': s.suuntoLink || '',
      Terminé: 'OUI'
    }));
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'historique_seances_passees.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Sessions Management
  const addSession = (dateStr?: string | React.MouseEvent) => {
    const finalDate = typeof dateStr === 'string' ? dateStr : format(new Date(), 'yyyy-MM-dd');
    const newSession: Session = {
      id: crypto.randomUUID(),
      date: finalDate,
      type: 'Nouvelle séance',
      description: '',
      sensations: '',
      suuntoLink: '',
      sessionNutrition: '',
      dailyNutrition: '',
      dailyHydration: '',
      completed: false
    };
    const newSessions = [...sessions, newSession].sort((a, b) => a.date.localeCompare(b.date));
    updateData(newSessions, races);
    startEditing(newSession);
  };

  const startEditing = (session: Session) => {
    setIsEditing(session.id);
    setEditForm(session);
  };

  const saveEdit = () => {
    if (!isEditing) return;
    const newSessions = sessions.map(s => s.id === isEditing ? { ...s, ...editForm } as Session : s).sort((a, b) => a.date.localeCompare(b.date));
    updateData(newSessions, races);
    setIsEditing(null);
  };

  const generateNutrition = async () => {
    if (!editForm.type && !editForm.description) return;
    setIsGeneratingNutrition(true);
    try {
      const response = await fetch('/api/generate-nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: editForm.type, description: editForm.description })
      });
      if (!response.ok) throw new Error('Failed to generate nutrition');
      const data = await response.json();
      setEditForm(prev => ({
        ...prev,
        sessionNutrition: data.sessionNutrition || prev.sessionNutrition,
        dailyNutrition: data.dailyNutrition || prev.dailyNutrition,
        dailyHydration: data.dailyHydration || prev.dailyHydration
      }));
    } catch (error) {
      console.error('Error generating nutrition:', error);
    } finally {
      setIsGeneratingNutrition(false);
    }
  };

  const cancelEdit = () => {
    setIsEditing(null);
    setEditForm({});
  };

  const deleteSession = (id: string) => {
    if (confirm('Supprimer cette séance ?')) {
      const newSessions = sessions.filter(s => s.id !== id);
      updateData(newSessions, races);
    }
  };

  const toggleCompleted = (id: string) => {
    const newSessions = sessions.map(s => s.id === id ? { ...s, completed: !s.completed } : s);
    updateData(newSessions, races);
  };

  // Races Management
  const handleAddRace = () => {
    if (!newRace.name || !newRace.date) return;
    const newRaces = [...races, { id: crypto.randomUUID(), ...newRace }].sort((a, b) => a.date.localeCompare(b.date));
    updateData(sessions, newRaces);
    setNewRace({ name: '', date: '' });
  };

  const deleteRace = (id: string) => {
    if (confirm('Supprimer cette course ?')) {
      const newRaces = races.filter(r => r.id !== id);
      updateData(sessions, newRaces);
    }
  };

  const handleSetMainObjective = (id: string) => {
    const updatedRaces = races.map(r => ({
      ...r,
      isMainObjective: r.id === id
    }));
    updateData(sessions, updatedRaces);
  };

  const downloadWeekImage = async (weekId: string, weekLabel: string) => {
    const element = document.getElementById(weekId);
    if (!element) return;
    
    try {
      const dataUrl = await toPng(element, {
        pixelRatio: 2,
        backgroundColor: document.documentElement.classList.contains('dark') ? '#18181b' : '#ffffff',
      });
      
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `Programme_${weekLabel.replace(/ /g, '_')}.png`;
      link.click();
    } catch (error) {
      console.error("Error generating image:", error);
    }
  };

  // Group sessions by week (always show current week + 4 future weeks, or past weeks if toggled)
  const weeks = useMemo(() => {
    const validSessions = sessions.filter(s => isValid(parseISO(s.date)));
    
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    let minDate = currentWeekStart;
    // Show at least 4 weeks into the future by default
    let maxDate = addDays(currentWeekStart, 4 * 7);

    validSessions.forEach(s => {
      const d = parseISO(s.date);
      const ws = startOfWeek(d, { weekStartsOn: 1 });
      if (showPastWeeks && ws < minDate) minDate = ws;
      if (ws > maxDate) maxDate = ws;
    });

    const groups = new Map<string, Session[]>();
    validSessions.forEach(s => {
      const d = parseISO(s.date);
      const ws = startOfWeek(d, { weekStartsOn: 1 });
      const key = format(ws, 'yyyy-MM-dd');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    });

    const result = [];
    let current = minDate;
    while (current <= maxDate) {
      const key = format(current, 'yyyy-MM-dd');
      // Only include weeks if they are >= currentWeekStart OR showPastWeeks is true
      if (showPastWeeks || current >= currentWeekStart) {
        const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(current, i));
        
        result.push({
          start: current,
          end: addDays(current, 6),
          days: weekDays.map(day => ({
            date: day,
            dateStr: format(day, 'yyyy-MM-dd'),
            sessions: (groups.get(key) || []).filter(s => s.date === format(day, 'yyyy-MM-dd'))
          }))
        });
      }
      
      current = addDays(current, 7);
    }

    return result;
  }, [sessions, showPastWeeks]);

  const renderSessionCard = (session: Session, isTodayTopView: boolean = false) => {
    const isExpanded = isTodayTopView || expandedSessions.has(session.id);
    
    return (
      <div 
        key={session.id} 
        className={`group relative bg-white dark:bg-zinc-900 border rounded-xl overflow-hidden transition-all ${
          session.completed 
            ? 'border-blue-200 dark:border-blue-900/50 bg-blue-50/30 dark:bg-blue-900/10' 
            : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 shadow-sm'
        }`}
      >
        {isEditing === session.id ? (
          <div className="p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                  <Calendar className="w-4 h-4" /> Date
                </label>
                <input 
                  type="date" 
                  value={editForm.date || ''} 
                  onChange={e => setEditForm({...editForm, date: e.target.value})}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                  <Activity className="w-4 h-4" /> Type de séance
                </label>
                <input 
                  type="text" 
                  placeholder="Ex: Endurance fondamentale..."
                  value={editForm.type || ''} 
                  onChange={e => setEditForm({...editForm, type: e.target.value})}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                  Macrocycle
                </label>
                <input 
                  type="text" 
                  placeholder="Ex: Phase 2 : Fondamentale"
                  value={editForm.macrocycle || ''} 
                  onChange={e => setEditForm({...editForm, macrocycle: e.target.value})}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                  Mésocycle
                </label>
                <input 
                  type="text" 
                  placeholder="Ex: Semaine 1 : Développement"
                  value={editForm.mesocycle || ''} 
                  onChange={e => setEditForm({...editForm, mesocycle: e.target.value})}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                  Microcycle (Pilier)
                </label>
                <input 
                  type="text" 
                  placeholder="Ex: Pilier Cardio"
                  value={editForm.microcycle || ''} 
                  onChange={e => setEditForm({...editForm, microcycle: e.target.value})}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                <AlignLeft className="w-4 h-4" /> Déroulement / Description
              </label>
              <textarea 
                rows={3}
                placeholder="Détails de la séance..."
                value={editForm.description || ''} 
                onChange={e => setEditForm({...editForm, description: e.target.value})}
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-y"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                <MessageSquare className="w-4 h-4" /> Sensations & Retour
              </label>
              <textarea 
                rows={2}
                placeholder="Comment s'est passée la séance ? (Fatigue, douleurs, facilité...)"
                value={editForm.sensations || ''} 
                onChange={e => setEditForm({...editForm, sensations: e.target.value})}
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-y"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                <LinkIcon className="w-4 h-4" /> Lien Suunto
              </label>
              <input 
                type="url"
                placeholder="https://maps.suunto.com/move/..."
                value={editForm.suuntoLink || ''} 
                onChange={e => setEditForm({...editForm, suuntoLink: e.target.value})}
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="space-y-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Nutrition & Hydratation</h4>
                <button
                  onClick={generateNutrition}
                  disabled={isGeneratingNutrition || (!editForm.type && !editForm.description)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGeneratingNutrition ? (
                    <div className="w-3.5 h-3.5 border-2 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Zap className="w-3.5 h-3.5" />
                  )}
                  Générer avec l'IA
                </button>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                  <Zap className="w-4 h-4" /> Conseil nutritif (pour la séance)
                </label>
                <input 
                  type="text"
                  placeholder="Ex: 1 gel toutes les 45min, boisson iso..."
                  value={editForm.sessionNutrition || ''} 
                  onChange={e => setEditForm({...editForm, sessionNutrition: e.target.value})}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                    <Apple className="w-4 h-4" /> Nutrition (journée)
                  </label>
                  <input 
                    type="text"
                    placeholder="Ex: Charge glucidique, repas léger..."
                    value={editForm.dailyNutrition || ''} 
                    onChange={e => setEditForm({...editForm, dailyNutrition: e.target.value})}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                    <Droplets className="w-4 h-4" /> Hydratation (journée)
                  </label>
                  <input 
                    type="text"
                    placeholder="Ex: 1L St Yorre + 1.5L eau claire"
                    value={editForm.dailyHydration || ''} 
                    onChange={e => setEditForm({...editForm, dailyHydration: e.target.value})}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button onClick={cancelEdit} className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg font-medium transition-colors">
                Annuler
              </button>
              <button onClick={saveEdit} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
                <Save className="w-4 h-4" />
                Enregistrer
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-start p-4 gap-4">
            <button 
              onClick={() => toggleCompleted(session.id)}
              className={`flex-shrink-0 mt-0.5 transition-colors ${session.completed ? 'text-blue-500' : 'text-zinc-300 dark:text-zinc-700 hover:text-blue-500'}`}
            >
              {session.completed ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
            </button>
            
            <div className="flex-grow min-w-0">
              <div 
                className={`flex items-center justify-between gap-2 ${isExpanded ? 'mb-2' : ''} ${!isTodayTopView ? 'cursor-pointer' : ''}`}
                onClick={() => !isTodayTopView && toggleSessionExpansion(session.id)}
              >
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    session.completed 
                      ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' 
                      : 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300'
                  }`}>
                    {session.type}
                  </span>
                  {!isExpanded && session.description && (
                    <span className="text-sm text-zinc-400 dark:text-zinc-500 truncate hidden sm:inline-block max-w-[200px]">
                      {session.description}
                    </span>
                  )}
                </div>
                {!isTodayTopView && (
                  <button className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                )}
              </div>
              
              {isExpanded && (
                <>
                  {(session.macrocycle || session.mesocycle || session.microcycle) && (
                    <div className="flex flex-wrap gap-2 mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      {session.macrocycle && <span className="bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded text-blue-600 dark:text-blue-400">{session.macrocycle}</span>}
                      {session.mesocycle && <span className="bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded text-indigo-600 dark:text-indigo-400">{session.mesocycle}</span>}
                      {session.microcycle && <span className="bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded text-teal-600 dark:text-teal-400">{session.microcycle}</span>}
                    </div>
                  )}
                  <p className={`text-sm whitespace-pre-wrap ${session.completed ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-600 dark:text-zinc-300'}`}>
                    {session.description || <span className="italic opacity-50">Aucune description</span>}
                  </p>
                  {session.sensations && (
                    <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-900/30">
                      <p className="text-sm text-blue-800 dark:text-blue-300 flex items-start gap-2">
                        <MessageSquare className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{session.sensations}</span>
                      </p>
                    </div>
                  )}
                  {(session.sessionNutrition || session.dailyNutrition || session.dailyHydration) && (
                    <div className="mt-4 space-y-2.5 bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border border-zinc-100 dark:border-zinc-800/50">
                      <h5 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Conseils & Nutrition</h5>
                      {session.sessionNutrition && (
                        <div className="flex items-start gap-2.5 text-sm">
                          <Zap className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                          <div><span className="font-medium text-zinc-700 dark:text-zinc-300">Séance :</span> <span className="text-zinc-600 dark:text-zinc-400">{session.sessionNutrition}</span></div>
                        </div>
                      )}
                      {session.dailyNutrition && (
                        <div className="flex items-start gap-2.5 text-sm">
                          <Apple className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                          <div><span className="font-medium text-zinc-700 dark:text-zinc-300">Journée :</span> <span className="text-zinc-600 dark:text-zinc-400">{session.dailyNutrition}</span></div>
                        </div>
                      )}
                      {session.dailyHydration && (
                        <div className="flex items-start gap-2.5 text-sm">
                          <Droplets className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                          <div><span className="font-medium text-zinc-700 dark:text-zinc-300">Hydratation :</span> <span className="text-zinc-600 dark:text-zinc-400">{session.dailyHydration}</span></div>
                        </div>
                      )}
                    </div>
                  )}
                  {session.suuntoLink && (
                    <a 
                      href={session.suuntoLink} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline"
                    >
                      <LinkIcon className="w-4 h-4" />
                      Voir sur Suunto
                    </a>
                  )}
                </>
              )}
            </div>

            <div className={`flex items-center gap-1 transition-opacity ${isExpanded ? 'sm:opacity-0 group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              <button 
                onClick={(e) => { e.stopPropagation(); startEditing(session); }}
                className="p-2 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors"
                title="Modifier"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                title="Supprimer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Scroll to current week on load or tab change
  useEffect(() => {
    if (activeTab === 'programme') {
      const currentWeekId = `week-${format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')}`;
      setTimeout(() => {
        const element = document.getElementById(currentWeekId);
        if (element) {
          const headerOffset = 80;
          const elementPosition = element.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
          window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
          });
        }
      }, 300);
    }
  }, [activeTab, activeProfileId]);

  const getCurrentPhases = () => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const todaySession = sessions.find(s => s.date === todayStr);

    let macro = todaySession?.macrocycle || '';
    let meso = todaySession?.mesocycle || '';
    let micro = todaySession?.microcycle || '';

    const mainRace = races.find(r => r.isMainObjective);

    if (mainRace && (!macro || !meso)) {
      const raceD = startOfDay(parseISO(mainRace.date));
      const currentD = startOfDay(new Date());
      const daysToRace = differenceInDays(raceD, currentD);
      const weeksToRace = Math.floor(daysToRace / 7);

      if (!macro) {
        if (daysToRace < 0) macro = "Phase 1 : Transition";
        else if (weeksToRace <= 3) macro = "Phase 4 : Affûtage";
        else if (weeksToRace <= 12) macro = "Phase 3 : Spécifique";
        else if (weeksToRace <= 24) macro = "Phase 2 : Fondamentale";
        else macro = "Phase 1 : Transition";
      }

      if (!meso) {
        if (daysToRace < 0) meso = "Récupération";
        else if (weeksToRace <= 3) {
           if (weeksToRace === 0) meso = "Semaine 4 : Assimilation";
           else if (weeksToRace === 1) meso = "Semaine 3 : Surcharge";
           else meso = "Semaine 2 : Développement";
        } else {
           const offset = weeksToRace % 4; 
           if (offset === 0) meso = "Semaine 4 : Assimilation";
           else if (offset === 1) meso = "Semaine 3 : Choc";
           else if (offset === 2) meso = "Semaine 2 : Surcharge";
           else meso = "Semaine 1 : Développement";
        }
      }
    }

    if (!micro && todaySession && todaySession.type) {
      const t = todaySession.type.toLowerCase();
      if (t.includes('cardio') || t.includes('fractionné') || t.includes('vma') || t.includes('intensité') || t.includes('seuil')) micro = "Pilier Cardio";
      else if (t.includes('renfo') || t.includes('ppg') || t.includes('gainage')) micro = "Pilier Renforcement";
      else if (t.includes('volume') || t.includes('long')) micro = "Pilier Volume";
      else if (t.includes('repos') || t.includes('récup') || t.includes('regeneration') || t.includes('régénération')) micro = "Pilier Régénération";
      else micro = "Pilier Endurance";
    }

    return {
      macro: macro || (mainRace ? "Calcul en cours..." : "Non défini (Fixer un objectif)"),
      meso: meso || (mainRace ? "Calcul en cours..." : "-"),
      micro: micro || (todaySession ? "Pilier Endurance" : "Pas de séance aujourd'hui")
    };
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-white shadow-sm">
              <Dumbbell className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight hidden md:block flex items-center gap-2">
              Minguen Coaching <span className="text-xs font-normal text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md ml-2">v2.1</span>
            </h1>
            
            <div className="ml-2 sm:ml-4 border-l border-zinc-200 dark:border-zinc-800 pl-2 sm:pl-4">
              <select
                value={activeProfileId}
                onChange={(e) => {
                  if (e.target.value === 'NEW_PROFILE') {
                    const name = prompt('Nom du nouveau profil :');
                    if (name && name.trim()) {
                      const newProfile = { id: crypto.randomUUID(), name: name.trim() };
                      const newProfiles = [...profiles, newProfile];
                      setProfiles(newProfiles);
                      localStorage.setItem('fitplan-profiles', JSON.stringify(newProfiles));
                      setActiveProfileId(newProfile.id);
                      localStorage.setItem('fitplan-active-profile', newProfile.id);
                      setDoc(doc(db, 'plans', 'metadata'), { profiles: newProfiles }, { merge: true });
                    }
                  } else {
                    setActiveProfileId(e.target.value);
                    localStorage.setItem('fitplan-active-profile', e.target.value);
                  }
                }}
                className="bg-zinc-100 dark:bg-zinc-800 border-none text-sm font-medium rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer max-w-[120px] sm:max-w-[200px] truncate"
              >
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                <option value="NEW_PROFILE">+ Nouveau profil</option>
              </select>
            </div>
          </div>
          
          <nav className="flex items-center gap-1 sm:gap-2">
            <button 
              onClick={() => setActiveTab('programme')} 
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'programme' ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span className="hidden sm:inline">Programme</span>
            </button>
            <button 
              onClick={() => setActiveTab('courses')} 
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'courses' ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
            >
              <Flag className="w-4 h-4" />
              <span className="hidden sm:inline">Courses</span>
            </button>
            <button 
              onClick={() => setActiveTab('import')} 
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'import' ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span className="hidden sm:inline">Import CSV</span>
            </button>
          </nav>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1.5 rounded-full">
                <Cloud className={`w-3.5 h-3.5 ${isSyncing ? 'text-blue-500 animate-pulse' : isCloudLoaded ? 'text-blue-500' : 'text-zinc-400'}`} />
                {isSyncing ? 'Synchronisation...' : isCloudLoaded ? 'Synchronisé sur le Cloud' : 'Connexion...'}
              </div>
            </div>
            <button 
              onClick={handleExportHistory}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors shadow-sm"
              title="Télécharger l'historique des séances passées"
            >
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">Historique</span>
            </button>
            <button 
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
              title="Exporter tout le programme"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Exporter</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* TAB: PROGRAMME */}
        {activeTab === 'programme' && (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Mon Programme</h2>
                <p className="text-zinc-500 dark:text-zinc-400 mt-1">Gérez vos semaines d'entraînement.</p>
              </div>
              <button 
                onClick={addSession}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Ajouter une séance</span>
                <span className="sm:hidden">Ajouter</span>
              </button>
            </div>

            {/* Cycle Phases Indicators */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white dark:bg-zinc-900 px-5 py-4 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex items-start gap-4">
                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Flag className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Macrocycle</h4>
                  <div className="font-bold text-zinc-900 dark:text-zinc-100">{getCurrentPhases().macro}</div>
                </div>
              </div>
              <div className="bg-white dark:bg-zinc-900 px-5 py-4 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex items-start gap-4">
                <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Mésocycle</h4>
                  <div className="font-bold text-zinc-900 dark:text-zinc-100">{getCurrentPhases().meso}</div>
                </div>
              </div>
              <div className="bg-white dark:bg-zinc-900 px-5 py-4 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex items-start gap-4">
                <div className="w-10 h-10 bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Microcycle (Aujourd'hui)</h4>
                  <div className="font-bold text-zinc-900 dark:text-zinc-100">{getCurrentPhases().micro}</div>
                </div>
              </div>
            </div>

            {/* Today's Sessions */}
            <div className="mb-8">
              <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-500" />
                Aujourd'hui
              </h3>
              <div className="space-y-4">
                {todaysSessions.length > 0 ? (
                  todaysSessions.map(s => renderSessionCard(s, true))
                ) : (
                  <div className="flex items-center justify-between px-4 py-4 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 group/empty transition-colors hover:border-blue-200 dark:hover:border-blue-900/50">
                    <span className="text-sm text-zinc-500 dark:text-zinc-400 italic">Aucune séance prévue aujourd'hui (Repos)</span>
                    <button 
                      onClick={() => addSession(todayStr)}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 rounded-lg transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Ajouter
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Races Countdown Banner */}
            {races.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {races.map(race => {
                  const days = differenceInDays(parseISO(race.date), startOfDay(new Date()));
                  return (
                    <div key={race.id} className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center gap-4 shadow-sm">
                      <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-500 rounded-full flex items-center justify-center flex-shrink-0">
                        <Trophy className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-zinc-900 dark:text-zinc-100 truncate">{race.name}</h4>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate">
                          {format(parseISO(race.date), 'd MMM yyyy', {locale: fr})} • <span className="font-medium text-amber-600 dark:text-amber-500">{days > 0 ? `J-${days}` : days === 0 ? "Aujourd'hui" : 'Terminée'}</span>
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold tracking-tight">Semaines d'entraînement</h3>
              <button
                onClick={() => setShowPastWeeks(!showPastWeeks)}
                className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 flex items-center gap-2 py-1 px-3 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                {showPastWeeks ? (
                  <>
                    <ChevronUp className="w-4 h-4" /> Masquer les semaines passées
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" /> Afficher les semaines passées
                  </>
                )}
              </button>
            </div>

            <div className="space-y-10">
              {weeks.map((week) => {
                const weekId = `week-${format(week.start, 'yyyy-MM-dd')}`;
                const weekLabel = `Semaine du ${format(week.start, 'd MMM', { locale: fr })} au ${format(week.end, 'd MMM yyyy', { locale: fr })}`;
                
                return (
                <div key={weekId} id={weekId} className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                  {/* Week Header */}
                  <div className="bg-zinc-50 dark:bg-zinc-950/50 px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 capitalize">
                      {weekLabel}
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setConfirmDeleteWeek(week.start.toISOString())}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-500/10 dark:hover:bg-red-500/20 rounded-lg transition-colors"
                        title="Vider la semaine"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span className="hidden sm:inline">Vider</span>
                      </button>
                      <button
                        onClick={() => downloadWeekImage(weekId, weekLabel)}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 rounded-lg transition-colors"
                        title="Télécharger le programme de la semaine en image"
                      >
                        <Camera className="w-4 h-4" />
                        <span className="hidden sm:inline">Image</span>
                      </button>
                    </div>
                  </div>

                  {/* Days List */}
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                    {week.days.map(day => (
                      <div key={day.dateStr} className="flex flex-col sm:flex-row p-4 sm:p-6 gap-4 sm:gap-6 hover:bg-zinc-50/30 dark:hover:bg-zinc-800/10 transition-colors">
                        {/* Date Column */}
                        <div className="sm:w-32 flex-shrink-0 flex flex-row sm:flex-col items-baseline sm:items-start gap-2 sm:gap-0">
                          <div className="text-sm font-medium text-zinc-500 dark:text-zinc-400 capitalize">
                            {format(day.date, 'EEEE', { locale: fr })}
                          </div>
                          <div className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                            {format(day.date, 'd MMM', { locale: fr })}
                          </div>
                        </div>

                        {/* Sessions Column */}
                        <div className="flex-grow space-y-3">
                          {day.sessions.length === 0 ? (
                            <div className="h-full min-h-[3.5rem] flex items-center justify-between px-4 py-3 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 group/empty transition-colors hover:border-blue-200 dark:hover:border-blue-900/50">
                              <span className="text-sm text-zinc-400 dark:text-zinc-500 italic">Repos</span>
                              <button 
                                onClick={() => addSession(day.dateStr)}
                                className="p-1.5 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-all opacity-0 group-hover/empty:opacity-100 sm:focus:opacity-100"
                                title="Ajouter une séance ce jour"
                              >
                                <Plus className="w-5 h-5" />
                              </button>
                            </div>
                          ) : (
                            day.sessions.map(session => renderSessionCard(session, false))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB: COURSES */}
        {activeTab === 'courses' && (
          <div className="space-y-8 max-w-3xl mx-auto">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Mes Courses</h2>
              <p className="text-zinc-500 dark:text-zinc-400 mt-1">Ajoutez vos objectifs pour voir le compte à rebours sur le dashboard.</p>
            </div>

            <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-4">
              <h3 className="text-lg font-semibold">Ajouter une course</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Nom de la course</label>
                  <input 
                    type="text" 
                    placeholder="Ex: Marathon de Paris"
                    value={newRace.name}
                    onChange={e => setNewRace({...newRace, name: e.target.value})}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Date</label>
                  <input 
                    type="date" 
                    value={newRace.date}
                    onChange={e => setNewRace({...newRace, date: e.target.value})}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button 
                  onClick={handleAddRace}
                  disabled={!newRace.name || !newRace.date}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Ajouter l'objectif
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Vos objectifs enregistrés</h3>
              {races.length === 0 ? (
                <div className="text-center py-12 bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800">
                  <Trophy className="w-10 h-10 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
                  <p className="text-zinc-500 dark:text-zinc-400">Aucune course enregistrée pour le moment.</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {races.sort((a,b) => a.date.localeCompare(b.date)).map(race => {
                    const days = differenceInDays(parseISO(race.date), startOfDay(new Date()));
                    return (
                      <div key={race.id} className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-between shadow-sm">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-500 rounded-full flex items-center justify-center flex-shrink-0">
                            <Trophy className="w-6 h-6" />
                          </div>
                          <div>
                            <h4 className="font-bold text-lg text-zinc-900 dark:text-zinc-100">{race.name}</h4>
                            <p className="text-zinc-500 dark:text-zinc-400">
                              {format(parseISO(race.date), 'EEEE d MMMM yyyy', {locale: fr})}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-600 dark:text-zinc-400 font-medium whitespace-nowrap">
                            <input 
                              type="radio" 
                              name="mainObjective" 
                              checked={race.isMainObjective || false}
                              onChange={() => handleSetMainObjective(race.id)}
                              className="w-4 h-4 text-blue-600 bg-zinc-100 border-zinc-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600 cursor-pointer"
                            />
                            <span className="hidden sm:inline">Objectif Principal</span>
                            <span className="sm:hidden">Principal</span>
                          </label>
                          <div className="text-right hidden md:block">
                            <div className="text-2xl font-bold text-amber-600 dark:text-amber-500">
                              {days > 0 ? `J-${days}` : days === 0 ? "Aujourd'hui" : 'Terminée'}
                            </div>
                            <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Compte à rebours</div>
                          </div>
                          <button 
                            onClick={() => deleteRace(race.id)}
                            className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                            title="Supprimer"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB: IMPORT CSV */}
        {activeTab === 'import' && (
          <div className="space-y-8 max-w-3xl mx-auto">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Importer des séances</h2>
              <p className="text-zinc-500 dark:text-zinc-400 mt-1">Collez vos données CSV ci-dessous pour compléter votre programme.</p>
            </div>
            
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-6">
              <div className="flex flex-col gap-3">
                <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Mode d'importation</label>
                <div className="flex flex-col sm:flex-row gap-4">
                  <label className={`flex items-center gap-3 cursor-pointer p-4 rounded-xl border transition-colors flex-1 ${importMode === 'replace' ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/10' : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}>
                    <input 
                      type="radio" 
                      name="importMode" 
                      checked={importMode === 'replace'} 
                      onChange={() => setImportMode('replace')}
                      className="w-4 h-4 text-blue-600 focus:ring-blue-500 hidden"
                    />
                    <div className="w-4 h-4 rounded-full border border-zinc-300 dark:border-zinc-600 flex items-center justify-center flex-shrink-0">
                      {importMode === 'replace' && <div className="w-2 h-2 rounded-full bg-blue-600" />}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Mettre à jour</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Remplace les séances existantes sur les mêmes dates.</span>
                    </div>
                  </label>
                  <label className={`flex items-center gap-3 cursor-pointer p-4 rounded-xl border transition-colors flex-1 ${importMode === 'add' ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/10' : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}>
                    <input 
                      type="radio" 
                      name="importMode" 
                      checked={importMode === 'add'} 
                      onChange={() => setImportMode('add')}
                      className="w-4 h-4 text-blue-600 focus:ring-blue-500 hidden"
                    />
                    <div className="w-4 h-4 rounded-full border border-zinc-300 dark:border-zinc-600 flex items-center justify-center flex-shrink-0">
                      {importMode === 'add' && <div className="w-2 h-2 rounded-full bg-blue-600" />}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Ajouter à la suite</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Ajoute les séances sans supprimer les existantes.</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <label className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Collez le texte CSV ici</label>
                  <span className="text-[11px] text-zinc-500 font-mono bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">Format : Date,Type,Description,...</span>
                </div>
                <textarea 
                  value={csvInput}
                  onChange={e => setCsvInput(e.target.value)}
                  placeholder="Date,Type,Description,Sensations,Macrocycle,Mesocycle,Microcycle,Terminé&#10;2024-05-12,Endurance,Footing 45min,Très bonnes sensations,Phase 2 : Fondamentale,Semaine 1,Pilier Endurance,OUI&#10;2024-05-14,Fractionné,10x400m,,,,NON"
                  className="w-full h-64 px-4 py-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm whitespace-pre"
                />
              </div>
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <input 
                    type="file" 
                    accept=".csv" 
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl transition-colors"
                  >
                    <Upload className="w-5 h-5 text-zinc-500" />
                    Importer un fichier
                  </button>
                </div>
                <button 
                  onClick={handleTextCsvImport}
                  disabled={!csvInput.trim()}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-colors shadow-sm"
                >
                  <Plus className="w-5 h-5" />
                  {importMode === 'replace' ? 'Mettre à jour via le texte' : 'Ajouter via le texte'}
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
      {/* Delete Week Confirmation Modal */}
      {confirmDeleteWeek && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 max-w-md w-full shadow-xl border border-zinc-200 dark:border-zinc-800">
            <h3 className="text-xl font-bold mb-4">Vider la semaine ?</h3>
            <p className="text-zinc-600 dark:text-zinc-400 mb-6">
              Êtes-vous sûr de vouloir supprimer toutes les séances de cette semaine ? Cette action est irréversible.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmDeleteWeek(null)}
                className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg font-medium transition-colors"
              >
                Annuler
              </button>
              <button 
                onClick={() => {
                  deleteWeekSessions(new Date(confirmDeleteWeek));
                  setConfirmDeleteWeek(null);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
