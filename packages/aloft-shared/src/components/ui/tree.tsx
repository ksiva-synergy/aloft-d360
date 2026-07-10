'use client'

import React, { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface TreeNode {
  name: string;
  children?: TreeNode[];
}

interface TreeProps {
  data: TreeNode;
}

const Tree: React.FC<TreeProps> = ({ data }) => {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const toggleNode = (nodeName: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeName)) {
      newExpanded.delete(nodeName);
    } else {
      newExpanded.add(nodeName);
    }
    setExpandedNodes(newExpanded);
  };

  const renderTree = (node: TreeNode, level: number = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedNodes.has(node.name);
    const isRoot = level === 0;

    return (
      <li key={node.name} className="list-none">
        <div 
          className={`flex items-center py-2 px-3 rounded-lg transition-colors ${
            isRoot 
              ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-100 font-semibold' 
              : 'hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
          style={{ paddingLeft: `${level * 20 + 12}px` }}
        >
          {hasChildren && (
            <button
              onClick={() => toggleNode(node.name)}
              className="mr-2 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          )}
          {!hasChildren && <div className="w-6 mr-2" />}
          <span className="text-sm">{node.name}</span>
        </div>
        
        {hasChildren && isExpanded && (
          <ul className="mt-1">
            {node.children!.map((child) => renderTree(child, level + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <ul className="space-y-1">
        {renderTree(data)}
      </ul>
    </div>
  );
};

export default Tree;
