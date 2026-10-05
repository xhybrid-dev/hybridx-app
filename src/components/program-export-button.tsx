'use client';

import { Download } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';
import { saveFile } from '@/lib/native';
import { programFilename, programToCsv } from '@/lib/program-csv';
import type { Program } from '@/models/types';

interface ProgramExportButtonProps {
  program: Program;
}

export function ProgramExportButton({ program }: ProgramExportButtonProps) {
  const { toast } = useToast();

  const handleExport = async () => {
    try {
      const csv = programToCsv(program);
      const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
      await saveFile(blob, programFilename(program));
    } catch (err) {
      logger.error('Failed to export program:', err);
      toast({
        title: 'Export failed',
        description: 'Could not export this program to CSV.',
        variant: 'destructive',
      });
    }
  };

  return (
    <DropdownMenuItem onClick={handleExport}>
      <Download className="mr-2 h-4 w-4" />
      Export as CSV
    </DropdownMenuItem>
  );
}
