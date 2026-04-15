import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Upload, Download, Plus, Trash2, Edit2, CheckCircle2, Circle, Calendar, Activity, AlignLeft, Save, FileSpreadsheet, Dumbbell, Trophy, LayoutDashboard, FileText, Flag, MessageSquare, Cloud, Camera } from 'lucide-react';
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
}

interface Race {
  id: string;
  name: string;
  date: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'programme' | 'courses' | 'import'>('programme');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCloudLoaded, setIsCloudLoaded] = useState(false);
  
  const [sessions, setSessions] = useState<Session[]>(() => {
    const saved = localStorage.getItem('fitplan-sessions');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { return []; }
    }
    return [];
  });

  const [races, setRaces] = useState<Race[]>(() => {
    const saved = localStorage.getItem('fitplan-races');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { return []; }
    }
    return [];
  });

  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Session>>({});
  const [csvInput, setCsvInput] = useState('');
  const [newRace, setNewRace] = useState({ name: '', date: '' });
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateData = async (newSessions: Session[], newRaces: Race[]) => {
    setSessions(newSessions);
    setRaces(newRaces);
    localStorage.setItem('fitplan-sessions', JSON.stringify(newSessions));
    localStorage.setItem('fitplan-races', JSON.stringify(newRaces));
    
    setIsSyncing(true);
    try {
      await setDoc(doc(db, 'plans', 'global-plan'), {
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

  // 1. Listen to Firestore
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'plans', 'global-plan'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const cloudSessions = data.sessions || [];
        const cloudRaces = data.races || [];
        
        setSessions(cloudSessions);
        setRaces(cloudRaces);
        localStorage.setItem('fitplan-sessions', JSON.stringify(cloudSessions));
        localStorage.setItem('fitplan-races', JSON.stringify(cloudRaces));
      } else {
        // If cloud is empty, upload local data
        if (sessions.length > 0 || races.length > 0) {
          updateData(sessions, races);
        }
      }
      setIsCloudLoaded(true);
    }, (error) => {
      console.error("Firestore Error:", error);
      setIsCloudLoaded(true);
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const processCsvData = (data: any[]) => {
    const imported: Session[] = data.map((row: any) => ({
      id: crypto.randomUUID(),
      date: row.Date || row.date || '',
      type: row.Type || row.type || '',
      description: row.Description || row.description || row.Déroulement || row.deroulement || '',
      sensations: row.Sensations || row.sensations || row.Ressenti || row.ressenti || '',
      completed: (row.Terminé || row.termine || row.Completed || '').toUpperCase() === 'OUI'
    })).filter(s => s.date);

    const combined = [...sessions, ...imported].sort((a, b) => a.date.localeCompare(b.date));
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

  // Sessions Management
  const addSession = (dateStr?: string | React.MouseEvent) => {
    const finalDate = typeof dateStr === 'string' ? dateStr : format(new Date(), 'yyyy-MM-dd');
    const newSession: Session = {
      id: crypto.randomUUID(),
      date: finalDate,
      type: 'Nouvelle séance',
      description: '',
      sensations: '',
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

  // Group sessions by week (always show current week + 4 future weeks)
  const weeks = useMemo(() => {
    const validSessions = sessions.filter(s => isValid(parseISO(s.date)));
    
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    let minDate = currentWeekStart;
    // Show at least 4 weeks into the future by default
    let maxDate = addDays(currentWeekStart, 4 * 7);

    validSessions.forEach(s => {
      const d = parseISO(s.date);
      const ws = startOfWeek(d, { weekStartsOn: 1 });
      if (ws < minDate) minDate = ws;
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
      
      current = addDays(current, 7);
    }

    return result;
  }, [sessions]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center text-white shadow-sm">
              <Dumbbell className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight hidden md:block flex items-center gap-2">
              FitPlan Studio <span className="text-xs font-normal text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md ml-2">v2.1</span>
            </h1>
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
                <Cloud className={`w-3.5 h-3.5 ${isSyncing ? 'text-emerald-500 animate-pulse' : isCloudLoaded ? 'text-emerald-500' : 'text-zinc-400'}`} />
                {isSyncing ? 'Synchronisation...' : isCloudLoaded ? 'Synchronisé sur le Cloud' : 'Connexion...'}
              </div>
            </div>
            <button 
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-sm"
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
                    <button
                      onClick={() => downloadWeekImage(weekId, weekLabel)}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20 rounded-lg transition-colors"
                      title="Télécharger le programme de la semaine en image"
                    >
                      <Camera className="w-4 h-4" />
                      <span className="hidden sm:inline">Image</span>
                    </button>
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
                            <div className="h-full min-h-[3.5rem] flex items-center justify-between px-4 py-3 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 group/empty transition-colors hover:border-emerald-200 dark:hover:border-emerald-900/50">
                              <span className="text-sm text-zinc-400 dark:text-zinc-500 italic">Repos</span>
                              <button 
                                onClick={() => addSession(day.dateStr)}
                                className="p-1.5 text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition-all opacity-0 group-hover/empty:opacity-100 sm:focus:opacity-100"
                                title="Ajouter une séance ce jour"
                              >
                                <Plus className="w-5 h-5" />
                              </button>
                            </div>
                          ) : (
                            day.sessions.map(session => (
                              <div 
                                key={session.id} 
                                className={`group relative bg-white dark:bg-zinc-900 border rounded-xl overflow-hidden transition-all ${
                                  session.completed 
                                    ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-900/10' 
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
                                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
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
                                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
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
                                        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none resize-y"
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
                                        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none resize-y"
                                      />
                                    </div>
                                    <div className="flex items-center justify-end gap-2 pt-2">
                                      <button onClick={cancelEdit} className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg font-medium transition-colors">
                                        Annuler
                                      </button>
                                      <button onClick={saveEdit} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors">
                                        <Save className="w-4 h-4" />
                                        Enregistrer
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col sm:flex-row sm:items-start p-4 gap-4">
                                    <button 
                                      onClick={() => toggleCompleted(session.id)}
                                      className={`flex-shrink-0 mt-0.5 transition-colors ${session.completed ? 'text-emerald-500' : 'text-zinc-300 dark:text-zinc-700 hover:text-emerald-500'}`}
                                    >
                                      {session.completed ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                                    </button>
                                    
                                    <div className="flex-grow min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                          session.completed 
                                            ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' 
                                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300'
                                        }`}>
                                          {session.type}
                                        </span>
                                      </div>
                                      <p className={`text-sm whitespace-pre-wrap ${session.completed ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-600 dark:text-zinc-300'}`}>
                                        {session.description || <span className="italic opacity-50">Aucune description</span>}
                                      </p>
                                      {session.sensations && (
                                        <div className="mt-3 p-3 bg-emerald-50 dark:bg-emerald-900/10 rounded-lg border border-emerald-100 dark:border-emerald-900/30">
                                          <p className="text-sm text-emerald-800 dark:text-emerald-300 flex items-start gap-2">
                                            <MessageSquare className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                            <span>{session.sensations}</span>
                                          </p>
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-1 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button 
                                        onClick={() => startEditing(session)}
                                        className="p-2 text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition-colors"
                                        title="Modifier"
                                      >
                                        <Edit2 className="w-4 h-4" />
                                      </button>
                                      <button 
                                        onClick={() => deleteSession(session.id)}
                                        className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                                        title="Supprimer"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))
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
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Date</label>
                  <input 
                    type="date" 
                    value={newRace.date}
                    onChange={e => setNewRace({...newRace, date: e.target.value})}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button 
                  onClick={handleAddRace}
                  disabled={!newRace.name || !newRace.date}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
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
                          <div className="text-right hidden sm:block">
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
            
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Collez le texte CSV ici</label>
                  <span className="text-xs text-zinc-500 font-mono">Format : Date, Type, Description, Sensations, Terminé</span>
                </div>
                <textarea 
                  value={csvInput}
                  onChange={e => setCsvInput(e.target.value)}
                  placeholder="Date,Type,Description,Sensations,Terminé&#10;2024-05-12,Endurance,Footing 45min,Très bonnes sensations,OUI&#10;2024-05-14,Fractionné,10x400m,,NON"
                  className="w-full h-64 px-4 py-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none font-mono text-sm whitespace-pre"
                />
                <p className="text-xs text-zinc-500">
                  Astuce : Les séances importées s'ajouteront à votre programme existant. Si vous importez des séances à des dates où vous en avez déjà, elles s'ajouteront à la suite.
                </p>
              </div>
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-zinc-500">Ou importer un fichier :</span>
                  <input 
                    type="file" 
                    accept=".csv" 
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    Choisir un fichier
                  </button>
                </div>
                <button 
                  onClick={handleTextCsvImport}
                  disabled={!csvInput.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Ajouter ces séances
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
